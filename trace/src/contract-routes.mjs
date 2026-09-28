// The HTTP side of the API contract, kept out of server.mjs:
//   GET  /api/contract?example=<name>   the contract as loaded: hasContract, file, endpoints, gaps (+ feature, route, about, apis)
//   POST /api/openapi?example=<name>    body = JSON { name?, text }: the file's name (informational) and its text; validated,
//                                       saved as the folder's only openapi.json / openapi.yaml
//                                       -> { file, hasContract, endpoints, gaps }, or { error } (400 bad file, 413 too large)
//   POST /api/contract/sample           T12.1: body { example, method, path, where, field } -> one AI-proposed sample
//                                       value for a field with no example (a "field-no-example" gap), checked
//                                       against its declared type when known (src/ai/sample.mjs). Display only:
//                                       never written to the contract, never fed back into matching.
//   GET  /ui/contract-panel.mjs         the UI's contract panel (empty state, upload, notice)
// Security: server.mjs calls checkRequest (src/http-guard.mjs: Host, Origin, content-type application/json) BEFORE this
// route is dispatched, and hands it `readBody` (the guard's bounded JSON reader); this file never reads `req` itself.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadContract, saveContract, describeContract, MAX_BYTES } from "./contract.mjs";
import { loadAiConfig, taskConfig } from "./ai/config.mjs";
import { makeProvider } from "./ai/provider.mjs";
import { proposeSample } from "./ai/sample.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const send = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };

// What /api/examples adds to each example.
/**
 * The contract summary `/api/examples` adds to one example's listing.
 *
 * @param {string} dir The example's directory.
 * @returns {{hasContract: boolean, contractFile: string|null, contractNotice: string|null, gaps: string[]}}
 */
export const contractFields = (dir) => {
  const c = loadContract(dir);
  return { hasContract: c.usable, contractFile: c.file, contractNotice: c.notice, gaps: c.gaps.map((g) => g.text) };
};

// Returns true when the request was one of ours.
/**
 * Handle the contract-related HTTP routes: `GET /api/contract`, `POST /api/openapi`, and serving the contract
 * panel's client script. Security (Host/Origin/content-type) is checked by the caller (`server.mjs`) before
 * this is dispatched; this file never reads `req` itself, only the guard's bounded `readBody`.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url The parsed request URL.
 * @param {{examplesDir: string, known: (name: string) => boolean,
 *   readBody: (req: object, opts: {limit: number}) => Promise<object>}} deps
 * @returns {Promise<boolean>} `true` when the request matched one of this file's routes and was handled.
 */
export async function contractRoute(req, res, url, { examplesDir, known, readBody }) {
  const p = url.pathname;
  if (p === "/ui/contract-panel.mjs") {
    res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" });
    res.end(fs.readFileSync(path.join(here, "ui", "contract-panel.mjs")));
    return true;
  }
  if (p === "/api/contract/sample" && req.method === "POST") return handleSample(req, res, { examplesDir, known, readBody });
  if (p !== "/api/contract" && !(p === "/api/openapi" && req.method === "POST")) return false;
  const name = url.searchParams.get("example");
  if (!known(name)) { send(res, 404, { error: "unknown example" }); return true; }
  const dir = path.join(examplesDir, name);

  if (p === "/api/contract") {
    try {
      const { feature, route, about } = JSON.parse(fs.readFileSync(path.join(dir, "feature.json"), "utf8"));
      const c = loadContract(dir);
      send(res, 200, { feature, route, about, apis: c.apis, ...describeContract(c) });
    } catch (err) {
      send(res, 500, { error: err.message });
    }
    return true;
  }

  try {
    // the file's text travels JSON-escaped, so the body limit is a multiple of the file limit; the file limit itself is checked below
    const { text } = await readBody(req, { limit: 3 * MAX_BYTES });
    if (typeof text !== "string") throw Object.assign(new Error('send JSON like {"name": "openapi.json", "text": "<the file>"}'), { code: 400 });
    if (Buffer.byteLength(text) > MAX_BYTES) throw Object.assign(new Error(`the file is larger than ${MAX_BYTES / 1024 / 1024} MB`), { code: 413 });
    saveContract(dir, text);
    send(res, 200, describeContract(loadContract(dir)));
  } catch (err) {
    const status = err.status ?? (err.code === 413 ? 413 : 400);
    if (!res.headersSent) send(res, status, { error: `That file can't be used: ${err.message}.`.replace(/\.\.$/, ".") });
  }
  return true;
}

// T12.1: propose a sample value for one field with no example. Never writes anything — the result is shown in
// the Contract card only (see src/ai/sample.mjs's header for why no eval variant is added for this).
async function handleSample(req, res, { examplesDir, known, readBody }) {
  let body;
  try { body = await readBody(req); } catch (err) { if (!res.headersSent) send(res, err.status ?? (err.code === 413 ? 413 : 400), { error: err.message }); return true; }
  const { example, method, path: epPath, where, field } = body ?? {};
  if (!known(example)) { send(res, 404, { error: "unknown example" }); return true; }
  if (typeof method !== "string" || typeof epPath !== "string" || (where !== "request" && where !== "response") || typeof field !== "string" || !field) {
    send(res, 400, { error: 'send JSON like {"example": "x", "method": "GET", "path": "<the endpoint\'s path>", "where": "response", "field": "weighted"}' });
    return true;
  }
  const dir = path.join(examplesDir, example);
  const c = loadContract(dir);
  const entry = (c.apis ?? []).find((a) => a.method === method && a.path === epPath);
  if (!entry) { send(res, 404, { error: "no such endpoint on this example's contract" }); return true; }
  const type = where === "request" ? entry.declared?.[field] : undefined; // responses carry no declared type today (openapi.mjs)
  const raw = where === "request" ? entry.request : entry.response;
  const siblings = Array.isArray(raw) ? raw[0] : raw;
  let providerFn;
  try { providerFn = makeProvider(taskConfig(loadAiConfig({ dir }), "generate-sample")); } catch (err) { send(res, 502, { error: err.message }); return true; }
  const result = await proposeSample({ endpoint: `${method} ${epPath}`, where, field, type, siblings }, providerFn);
  if (!result.ok) { send(res, 502, { error: `The model didn't give a usable sample: ${result.why}.` }); return true; }
  send(res, 200, { value: result.value, provenance: "synthetic" });
  return true;
}
