// The HTTP side of the import wizard (T13), kept out of server.mjs like contract-routes.mjs:
//   GET  /import-wizard                      standalone page that mounts the wizard for one example (?example=name)
//   GET  /ui/import-wizard.mjs               the wizard's UI module (step rendering + install*, all pure + DOM-only glue)
//   GET  /ui/subframe-fixture.mjs            the recorded (non-live) Subframe project fixture, T13.2
//   GET  /api/wizard/subframe/status         { connected, reason } from the MCP client (never fakes a connection)
//   POST /api/wizard/markers/suggest         body { source } -> { suggestions } (suggestMarkers, T18/T13.3)
//   POST /api/wizard/markers/apply           body { source, acceptedIds } -> { source } (applyMarkers, T18/T13.3)
//   POST /api/wizard/apply                   body { example, listKey?, pageSource? } -> the "wire it" hand-off (T13.6):
//                                             listKey sets/clears feature.json's existing `list` override (the same
//                                             field src/contract.mjs already reads); pageSource (marked-up TSX/JSX)
//                                             is written to the example's page file. Returns describeContract(...).
// Security: same as contract-routes.mjs — server.mjs calls checkRequest before this route is dispatched and hands
// it `readBody` (the guard's bounded JSON reader); this file never reads `req` itself.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadContract, describeContract, MAX_BYTES } from "./contract.mjs";
import { suggestMarkers, applyMarkers, parsePage } from "./import/index.mjs";
import { subframeConnectionStatus } from "./import/subframe/mcp-client.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const send = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const file = (res, p, type) => {
  let data;
  try { data = fs.readFileSync(p); } catch { res.writeHead(404, { "content-type": "text/plain" }); res.end("not found"); return; }
  res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  res.end(data);
};

// Update (or clear) feature.json's `list` override atomically; every other field is left byte-for-byte as JSON.stringify
// would write it (feature.json is small and hand-edited, so this is the same shape saveContract() uses for openapi files).
function setListOverride(dir, listKey) {
  const p = path.join(dir, "feature.json");
  const spec = JSON.parse(fs.readFileSync(p, "utf8"));
  if (listKey) spec.list = listKey; else delete spec.list;
  const tmp = path.join(dir, `.feature.json.${process.pid}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(spec, null, 2) + "\n");
  fs.renameSync(tmp, p);
}

function writePage(dir, spec, source) {
  const p = path.join(dir, spec.page);
  const tmp = path.join(dir, `.${path.basename(spec.page)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, source);
  fs.renameSync(tmp, p);
}

const STATIC = {
  "/import-wizard": ["ui/import-wizard.html", "text/html; charset=utf-8"],
  "/ui/import-wizard.mjs": ["ui/import-wizard.mjs", "text/javascript"],
  "/ui/subframe-fixture.mjs": ["import/subframe/fixtures/mock-project.mjs", "text/javascript"],
};

// Exact-match, like contract-routes.mjs (`p !== "/api/contract" && ...`) — never a prefix test, so the
// "no route is missing" guard in server.test.mjs sees exactly the paths this file can answer.
const API_PATHS = new Set(["/api/wizard/subframe/status", "/api/wizard/markers/suggest", "/api/wizard/markers/apply", "/api/wizard/apply"]);

/** Returns true when the request was one of the wizard's. */
export async function importWizardRoute(req, res, url, { examplesDir, known, readBody }) {
  const p = url.pathname;

  if (STATIC[p]) { file(res, path.join(here, STATIC[p][0]), STATIC[p][1]); return true; }
  if (!API_PATHS.has(p)) return false;

  if (p === "/api/wizard/subframe/status" && req.method === "GET") { send(res, 200, subframeConnectionStatus()); return true; }

  if (p === "/api/wizard/markers/suggest" && req.method === "POST") {
    try {
      const { source } = await readBody(req, { limit: MAX_BYTES });
      if (typeof source !== "string") throw Object.assign(new Error("send JSON like {\"source\": \"<page text>\"}"), { code: 400 });
      send(res, 200, { suggestions: suggestMarkers(source) });
    } catch (err) {
      if (!res.headersSent) send(res, err.status ?? (err.code === 413 ? 413 : 400), { error: `That page can't be read: ${err.message}.`.replace(/\.\.$/, ".") });
    }
    return true;
  }

  if (p === "/api/wizard/markers/apply" && req.method === "POST") {
    try {
      const { source, acceptedIds } = await readBody(req, { limit: MAX_BYTES });
      if (typeof source !== "string" || !Array.isArray(acceptedIds)) throw Object.assign(new Error('send JSON like {"source": "<page text>", "acceptedIds": ["dyn-1:2"]}'), { code: 400 });
      send(res, 200, { source: applyMarkers(source, acceptedIds) });
    } catch (err) {
      if (!res.headersSent) send(res, err.status ?? (err.code === 413 ? 413 : 400), { error: `Could not apply those markers: ${err.message}.`.replace(/\.\.$/, ".") });
    }
    return true;
  }

  if (p === "/api/wizard/apply" && req.method === "POST") {
    const body = await readBody(req).catch((err) => { send(res, err.status ?? 400, { error: err.message }); return null; });
    if (body === null) return true;
    const { example, listKey, pageSource } = body;
    if (!known(example)) { send(res, 404, { error: "unknown example" }); return true; }
    const dir = path.join(examplesDir, example);
    try {
      if (listKey !== undefined) setListOverride(dir, listKey);
      if (typeof pageSource === "string") {
        if (Buffer.byteLength(pageSource) > MAX_BYTES) throw Object.assign(new Error(`the page is larger than ${MAX_BYTES / 1024 / 1024} MB`), { status: 413 });
        try { parsePage(pageSource); } catch (e) { throw Object.assign(new Error(`that page is not valid JSX/TSX: ${e.message}`), { status: 400 }); }
        const spec = JSON.parse(fs.readFileSync(path.join(dir, "feature.json"), "utf8"));
        writePage(dir, spec, pageSource);
      }
      // `apis` too (like GET /api/contract does): the wizard's endpoint step needs it to re-render after a choice.
      const c = loadContract(dir);
      send(res, 200, { apis: c.apis, ...describeContract(c) });
    } catch (err) {
      if (!res.headersSent) send(res, err.status ?? 400, { error: err.message });
    }
    return true;
  }

  return false;
}
