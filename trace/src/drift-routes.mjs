// LIN-195/TR-32: a read-only UI surface for a stored contract-drift result (T27.1-T27.3's drift.mjs /
// drift-policy.mjs / drift-cli.mjs). This route only reads what `storeDrift` (drift-policy.mjs) already wrote
// to `<example>/drift.json` — it never runs a diff, never decides anything, and never triggers a check. Wiring
// a drift check into the live pipeline (`runPipeline`) is a separate, still-pending decision (LIN-6) and is not
// touched here.
//
//   GET /api/drift?example=<name>   the stored { report, decision } for that example, shaped for the UI, or
//                                    { available: false } if no drift.json exists yet
//   GET /drift                      the Drift page
//   GET /ui/drift.mjs               the Drift page's client module
//
// `example` is validated the same way every other per-example route in this codebase validates it (`known`,
// an allow-list callback backed by `listExamples()`), never a raw filesystem path — same convention as
// adapter-routes.mjs / contract-routes.mjs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Read an example's stored drift record (the file `storeDrift`, drift-policy.mjs, writes).
 *
 * @param {string} examplesDir The examples root (server.mjs's `examplesDir`).
 * @param {string} name An example name (already validated by the caller).
 * @returns {{report: object, decision: object}|null} The stored record, or `null` when no `drift.json` exists
 *   yet or it cannot be read/parsed.
 */
export function loadDriftReport(examplesDir, name) {
  try {
    return JSON.parse(fs.readFileSync(path.join(examplesDir, name, "drift.json"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Shape a stored drift record for the Drift page. Read-only shaping of an already-computed report and
 * decision; no drift logic lives here.
 *
 * @param {string} examplesDir The examples root.
 * @param {string} name An example name.
 * @returns {object} `{ available: false }` when no record exists yet, otherwise the shaped payload.
 */
export function driftPayload(examplesDir, name) {
  const stored = loadDriftReport(examplesDir, name);
  if (!stored) return { available: false };
  const { report, decision } = stored;
  return {
    available: true,
    hasDrift: report.hasDrift,
    added: report.added,
    removed: report.removed,
    changed: report.changed,
    status: decision.status,
    blocked: decision.blocked,
    reason: decision.reason,
    affected: decision.affected,
  };
}

const UI = { "/drift": ["ui/drift.html", "text/html; charset=utf-8"], "/ui/drift.mjs": ["ui/drift.mjs", "text/javascript"] };
const here = path.dirname(fileURLToPath(import.meta.url));
const readText = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };

/**
 * Handle the drift-result routes: `/api/drift`, the Drift page and its module.
 *
 * @param {URL} url The request's parsed URL.
 * @param {import("node:http").ServerResponse} res
 * @param {{examplesDir: string, known: (name: string) => boolean}} ctx Same shape adapter-routes.mjs /
 *   contract-routes.mjs use for per-example routes.
 * @returns {boolean} `true` when this handled the request.
 */
export function handleDriftRoute(url, res, ctx) {
  const p = url.pathname;
  const json = (code, body) => { res.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); return true; };
  const send = (type, text) => { res.writeHead(text == null ? 404 : 200, { "content-type": type, "cache-control": "no-store" }); res.end(text ?? "not found"); return true; };
  if (p === "/api/drift") {
    const name = url.searchParams.get("example");
    if (!ctx.known(name)) return json(404, { error: "unknown example" });
    return json(200, driftPayload(ctx.examplesDir, name));
  }
  if (UI[p]) return send(UI[p][1], readText(path.join(here, UI[p][0])) || null);
  return false;
}
