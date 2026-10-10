// Routes that report the eval harness's baseline: /api/quality, the Quality page and its module. Reads the
// already-computed eval/out/report.json (written by `npm run eval` / `npm run eval:baseline`); never runs the eval
// itself. Kept out of server.mjs so that file only gains one import and one line, same convention as build-routes.mjs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// A copy of eval/report.mjs's HEADLINE_METRICS list, not an import: the deploy script only packages `src/` and
// `examples/` (build-info.mjs's TOP_DIRS), so a route file under src/ cannot reach into eval/ at runtime. Keep in
// sync with eval/report.mjs by hand; quality-routes.test.mjs asserts the two lists still match in this dev tree.
const HEADLINE_METRICS = ["precision", "recall", "f1", "wrong_accept_rate", "coincidence_catch_rate", "questions_per_screen", "unnecessary_question_rate", "oracle_accuracy", "coupled_excess", "library_miss_rate"];

/**
 * Read `eval/out/report.json` from the Trace root.
 *
 * @param {string} root The server's root directory (same convention as `createBuildContext`'s `root`).
 * @returns {object|null} The parsed report, or `null` when no eval has been run yet or the file cannot be read.
 */
export function loadQualityReport(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, "eval", "out", "report.json"), "utf8"));
  } catch {
    return null;
  }
}

/**
 * The Quality page's data: headline metrics (all four truth tiers), determinism cleanliness, and runtime. Read-only
 * shaping of an already-computed report; no eval logic lives here.
 *
 * @param {string} root The server's root directory.
 * @returns {object} `{ available: false }` when no report exists yet, otherwise the shaped payload.
 */
export function qualityPayload(root) {
  const rep = loadQualityReport(root);
  if (!rep) return { available: false };
  const metrics = (tier) => Object.fromEntries(HEADLINE_METRICS.map((m) => [m, tier[m] ?? null]));
  return {
    available: true,
    variant: rep.variant,
    cases: Object.keys(rep.cases ?? {}).length,
    generated_by: rep.generated_by ?? null,
    report_hash: rep.report_hash,
    headline: {
      all: metrics(rep.headline.all),
      independent: metrics(rep.headline.independent),
      reference: metrics(rep.headline.reference),
      self: metrics(rep.headline.self),
    },
    determinism: { clean: rep.determinism.clean, cases_checked: rep.determinism.cases_checked, drift: rep.determinism.drift },
    timing: rep.timing,
  };
}

const UI = { "/quality": ["ui/quality.html", "text/html; charset=utf-8"], "/ui/quality.mjs": ["ui/quality.mjs", "text/javascript"] };
const here = path.dirname(fileURLToPath(import.meta.url));
const readText = (p) => { try { return fs.readFileSync(p, "utf8"); } catch { return ""; } };

/**
 * Handle the eval-quality routes: `/api/quality`, the Quality page and its module.
 *
 * @param {string} p The request's pathname.
 * @param {import("node:http").ServerResponse} res
 * @param {{root: string}} ctx From `createBuildContext` (build-routes.mjs) — only `root` is used here.
 * @returns {boolean} `true` when this handled the request.
 */
export function handleQualityRoute(p, res, ctx) {
  const json = (body) => { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); res.end(JSON.stringify(body)); return true; };
  const send = (type, text) => { res.writeHead(text == null ? 404 : 200, { "content-type": type, "cache-control": "no-store" }); res.end(text ?? "not found"); return true; };
  if (p === "/api/quality") return json(qualityPayload(ctx.root));
  if (UI[p]) return send(UI[p][1], readText(path.join(here, UI[p][0])) || null);
  return false;
}
