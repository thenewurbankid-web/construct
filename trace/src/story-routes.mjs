// The HTTP side of the page story, kept out of server.mjs:
//   GET  /api/story/draft?example=<name>   LIN-105/TR-10: a PROPOSED page story (goal + acceptance criteria) from
//                                          the example's design and API contract (src/ai/story-draft.mjs).
//                                          Proposal only: never written to story.md, never fed back into matching
//                                          or the eval corpus — the caller (the Story panel) decides whether to save it.
//   GET  /api/story?example=<name>         the SAVED story (src/ai/context.mjs loadStory): { goal, criteria, hasStory }.
//   POST /api/story?example=<name>         body { goal, criteria }: validated and written to the example's story.md
//                                          (src/ai/context.mjs saveStory) -> the loaded-back story, or { error } (400).
//   GET  /ui/story-panel.mjs               the UI's Story panel (empty/loaded state, editor, run-start gate)
// Security: server.mjs calls checkRequest (src/http-guard.mjs: Host, Origin, content-type application/json) BEFORE this
// route is dispatched, and hands it `readBody` (the guard's bounded JSON reader); this file never reads `req` itself.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readSpec } from "./contract.mjs";
import { loadAiConfig, taskConfig } from "./ai/config.mjs";
import { makeProvider } from "./ai/provider.mjs";
import { draftStory } from "./ai/story-draft.mjs";
import { loadStory, saveStory } from "./ai/context.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const send = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const MAX_BYTES = 200 * 1024;

// What /api/examples adds to each example.
/**
 * The story summary `/api/examples` adds to one example's listing.
 *
 * @param {string} dir The example's directory.
 * @returns {{hasStory: boolean}}
 */
export function storyFields(dir) {
  const { goal, criteria } = loadStory(dir);
  return { hasStory: !!(goal || criteria.length) };
}

/**
 * Handle the page-story draft route: `GET /api/story/draft`. Security (Host/Origin/content-type) is checked by
 * the caller (`server.mjs`) before this is dispatched; this file never reads `req` itself.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url The parsed request URL.
 * @param {{examplesDir: string, known: (name: string) => boolean,
 *   readBody: (req: object, opts: {limit: number}) => Promise<object>}} deps
 * @returns {Promise<boolean>} `true` when the request matched this file's route and was handled.
 */
export async function storyRoute(req, res, url, { examplesDir, known, readBody }) {
  const p = url.pathname;

  if (p === "/ui/story-panel.mjs") {
    res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" });
    res.end(fs.readFileSync(path.join(here, "ui", "story-panel.mjs")));
    return true;
  }

  if (p === "/api/story/draft" && req.method === "GET") {
    const name = url.searchParams.get("example");
    if (!known(name)) { send(res, 404, { error: "unknown example" }); return true; }
    const dir = path.join(examplesDir, name);
    const spec = readSpec(dir);
    const source = fs.readFileSync(path.join(dir, spec.page || "page.jsx"), "utf8");
    let providerFn;
    try { providerFn = makeProvider(taskConfig(loadAiConfig({ dir }), "draft-story")); } catch (err) { send(res, 502, { error: err.message }); return true; }
    const result = await draftStory({ dir, spec, source }, providerFn);
    if (!result.ok) { send(res, 502, { error: `The model didn't give a usable story: ${result.why}.` }); return true; }
    send(res, 200, { ok: true, goal: result.goal, criteria: result.criteria, markdown: result.markdown, dropped: result.dropped });
    return true;
  }

  if (p === "/api/story" && req.method === "GET") {
    const name = url.searchParams.get("example");
    if (!known(name)) { send(res, 404, { error: "unknown example" }); return true; }
    const dir = path.join(examplesDir, name);
    const { goal, criteria } = loadStory(dir);
    send(res, 200, { goal, criteria, hasStory: !!(goal || criteria.length) });
    return true;
  }

  if (p === "/api/story" && req.method === "POST") {
    const name = url.searchParams.get("example");
    if (!known(name)) { send(res, 404, { error: "unknown example" }); return true; }
    let body;
    try { body = await readBody(req, { limit: MAX_BYTES }); } catch (err) { if (!res.headersSent) send(res, err.status ?? (err.code === 413 ? 413 : 400), { error: err.message }); return true; }
    if (Buffer.byteLength(JSON.stringify(body ?? {})) > MAX_BYTES) { send(res, 400, { error: `That story is larger than ${MAX_BYTES / 1024} KB.` }); return true; }
    const { goal, criteria } = body ?? {};
    if (typeof goal !== "string") { send(res, 400, { error: "goal must be a string (it may be empty)" }); return true; }
    if (!Array.isArray(criteria) || !criteria.every((c) => typeof c === "string")) { send(res, 400, { error: "criteria must be a list of strings" }); return true; }
    const cleaned = criteria.map((c) => c.trim()).filter(Boolean);
    const dir = path.join(examplesDir, name);
    saveStory(dir, { goal: goal.trim(), criteria: cleaned });
    const loaded = loadStory(dir);
    send(res, 200, { goal: loaded.goal, criteria: loaded.criteria, hasStory: !!(loaded.goal || loaded.criteria.length) });
    return true;
  }

  return false;
}
