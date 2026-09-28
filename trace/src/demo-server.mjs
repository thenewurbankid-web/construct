// The demo shell's routes (src/ui/demo.html), kept out of server.mjs so that file only gains one line of wiring.
//   GET  /                      the demo shell ("Trace"); the full studio stays at /studio
//   GET  /demo/<file>           the shell's own scripts and styles (an allow-list, nothing else is served)
//   GET  /api/demo/status       is the helper for Suggest reachable? which scenarios have a Ledger / a fix applied?
//   POST /api/demo/apply-fix    "Backend ships the fix": saves a scenario's prepared contract (fixed.openapi.json) as its openapi.json
//   POST /api/demo/release      skips every Ask a run is still waiting on (a closed tab leaves one hanging, and a hanging run blocks Reset)
// Everything else the shell needs (runs, answers, preview, contract, reset) is the existing API.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadAiConfig, taskConfig } from "./ai/config.mjs";
import { saveContract } from "./contract.mjs";
import { SCENARIOS } from "./ui/scenarios.mjs";
import { PRODUCT } from "./ui/vocab.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ui = path.join(here, "ui");
const TYPES = { ".mjs": "text/javascript", ".css": "text/css", ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml" };
const ASSETS = new Set(["demo.mjs", "demo.css", "demo-tokens.css", "vocab.mjs", "scenarios.mjs", "icons.mjs", "wire-delay.mjs", "thumb.mjs", "assets/trace-mark.svg", "assets/trace-favicon.svg", "hero3d/hero.mjs", "hero3d/geometry.mjs", "hero3d/hero.css", "hero3d/hero.bundle.mjs",
  "canvas/geometry.mjs", "canvas/queue.mjs", "canvas/parts.mjs", "canvas/layout.mjs", "canvas/render.mjs", "canvas/map.mjs", "canvas/trace.mjs"]);

// Can the model behind Suggest be reached? Only a yes/no goes to the page (no model names on the demo path).
/**
 * Check whether the model configured for the "choose" task (Suggest) is reachable right now.
 *
 * @returns {Promise<boolean>} `true` if reachable; `false` on any error, timeout, or unrecognised/unconfigured
 *   provider. Only this yes/no is meant to reach the demo page — no model name.
 */
export async function suggestReady() {
  try {
    const c = taskConfig(loadAiConfig(), "choose");
    const get = (url) => fetch(url, { signal: AbortSignal.timeout(1500) });
    if (c.provider === "ollama") {
      const r = await get(`${c.baseUrl || "http://localhost:11434"}/api/tags`);
      if (!r.ok) return false;
      const names = ((await r.json()).models ?? []).map((m) => m.name);
      return names.some((n) => n === c.model || n.split(":")[0] === c.model);
    }
    if (c.provider === "anthropic") return !!process.env.ANTHROPIC_API_KEY;
    if (c.provider === "openai") return (await get(`${c.baseUrl || "http://localhost:1234"}/v1/models`)).ok;
    if (c.provider === "jev") return (await get(`${c.baseUrl || "http://127.0.0.1:8765"}/`)).status < 500;
  } catch {}
  return false;
}

// The shell's name and tagline come from vocab.mjs (one constant), filled in here so there is no flash of a placeholder.
/**
 * Render the demo shell's HTML, with `{{NAME}}`/`{{TAGLINE}}` filled in from `ui/vocab.mjs` (server-side, so
 * there is no flash of a placeholder).
 *
 * @returns {string} The shell's HTML, or `""` if `demo.html` cannot be read.
 */
export const renderShell = () => (read(path.join(ui, "demo.html")) ?? "").replaceAll("{{NAME}}", PRODUCT.name).replaceAll("{{TAGLINE}}", PRODUCT.tagline);

const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return null; } };

/**
 * The demo's per-scenario status: whether the example exists, how many saved answers it has (its "ledger"),
 * and whether a prepared fix exists and has already been applied.
 *
 * @param {string} examplesDir The examples root directory.
 * @returns {{id: string, example: string, present: boolean, ledger: number, fixable: boolean, fixed: boolean}[]}
 *   One entry per {@link SCENARIOS} scenario.
 */
export function scenarioStatus(examplesDir) {
  return SCENARIOS.map((s) => {
    const dir = path.join(examplesDir, s.example);
    const answers = read(path.join(dir, "answers.json"));
    let ledger = 0;
    try { ledger = Object.keys(JSON.parse(answers ?? "{}")).length; } catch {}
    const fixText = s.fix ? read(path.join(dir, s.fix)) : null;
    return { id: s.id, example: s.example, present: fs.existsSync(path.join(dir, "feature.json")), ledger, fixable: fixText != null, fixed: fixText != null && fixText === read(path.join(dir, "openapi.json")) };
  });
}

// Returns true when it handled the request.
/**
 * Handle the demo shell's own routes: the shell page, its static assets (allow-listed), status, "release" (skip
 * every run's pending Ask) and "apply-fix" (install a scenario's prepared contract).
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {URL} url The parsed request URL.
 * @param {{examplesDir: string, readBody: Function, json: Function, file: Function, runs?: Map<string, object>}} deps
 *   `runs`: in-flight runs, each with `finished` and (while waiting on a question) `waiting`.
 * @returns {Promise<boolean>} `true` when the request matched one of this file's routes and was handled.
 */
export async function demoRoute(req, res, url, { examplesDir, readBody, json, file, runs = new Map() }) {
  const p = url.pathname;
  if (p === "/") {
    res.writeHead(200, { "content-type": TYPES[".html"], "cache-control": "no-store" });
    res.end(renderShell());
    return true;
  }
  const asset = p.match(/^\/demo\/((?:assets\/|hero3d\/|canvas\/)?[\w.-]+)$/);
  if (asset) {
    if (ASSETS.has(asset[1])) file(res, path.join(ui, asset[1]), TYPES[path.extname(asset[1])]);
    else res.writeHead(404).end("not found");
    return true;
  }
  if (p === "/api/demo/status") {
    json(res, 200, { suggest: await suggestReady(), scenarios: scenarioStatus(examplesDir) });
    return true;
  }
  if (p === "/api/demo/release" && req.method === "POST") {
    let released = 0;
    const t0 = Date.now();
    // skipping an Ask lets the run reach its next Ask, so keep going until every run has finished (or 30 s pass)
    while (Date.now() - t0 < 30000) {
      const open = [...runs.values()].filter((r) => !r.finished);
      if (!open.length) break;
      for (const r of open) if (r.waiting) { const answer = r.waiting; r.waiting = null; answer({ skip: true }); released++; }
      await new Promise((r) => setTimeout(r, 150));
    }
    json(res, 200, { released, stillRunning: [...runs.values()].filter((r) => !r.finished).length });
    return true;
  }
  if (p === "/api/demo/apply-fix" && req.method === "POST") {
    const { example } = await readBody(req);
    const s = SCENARIOS.find((x) => x.example === example && x.fix);
    const dir = s && path.join(examplesDir, s.example);
    if (!s || !fs.existsSync(path.join(dir, s.fix))) return json(res, 404, { error: "no prepared fix for that scenario" }), true;
    try { saveContract(dir, fs.readFileSync(path.join(dir, s.fix), "utf8")); } catch (e) { return json(res, 500, { error: `the prepared fix is not a usable contract: ${e.message}` }), true; }
    json(res, 200, { ok: true });
    return true;
  }
  return false;
}
