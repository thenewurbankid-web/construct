import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { handleQualityRoute, loadQualityReport, qualityPayload } from "./quality-routes.mjs";
import { HEADLINE_METRICS } from "../eval/report.mjs";

const fakeRes = () => { const r = { code: null, headers: null, body: "", writeHead(c, h) { r.code = c; r.headers = h; }, end(b) { r.body = b; } }; return r; };
const call = (p, ctx) => { const res = fakeRes(); const handled = handleQualityRoute(p, res, ctx); return { handled, res, json: () => JSON.parse(res.body) }; };

const tier = (over = {}) => Object.fromEntries(HEADLINE_METRICS.map((m) => [m, 0.5]).concat(Object.entries(over)));

function fakeReport() {
  return {
    variant: "baseline",
    generated_by: "npm run eval:baseline",
    report_hash: "a".repeat(16),
    cases: { "a-1": {}, "a-2": {} },
    headline: { all: tier(), independent: tier(), reference: tier(), self: tier() },
    determinism: { clean: true, cases_checked: 2, drift: [] },
    timing: { case_analyze_ms: { p50: 12, p95: 40 }, case_pipeline_ms: { p50: 30, p95: 90 } },
  };
}

function rootWithReport(report) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "trace-quality-"));
  fs.mkdirSync(path.join(root, "eval", "out"), { recursive: true });
  if (report) fs.writeFileSync(path.join(root, "eval", "out", "report.json"), JSON.stringify(report));
  return root;
}

test("loadQualityReport returns null when eval/out/report.json does not exist", () => {
  assert.equal(loadQualityReport(rootWithReport(null)), null);
});

test("loadQualityReport reads and parses an existing report", () => {
  const report = fakeReport();
  assert.deepEqual(loadQualityReport(rootWithReport(report)), report);
});

test("qualityPayload is unavailable with no report", () => {
  assert.deepEqual(qualityPayload(rootWithReport(null)), { available: false });
});

test("qualityPayload shapes headline metrics, determinism and timing from a real report", () => {
  const report = fakeReport();
  const p = qualityPayload(rootWithReport(report));
  assert.equal(p.available, true);
  assert.equal(p.variant, "baseline");
  assert.equal(p.cases, 2);
  assert.equal(p.report_hash, report.report_hash);
  assert.deepEqual(Object.keys(p.headline).sort(), ["all", "independent", "reference", "self"]);
  assert.deepEqual(Object.keys(p.headline.independent).sort(), [...HEADLINE_METRICS].sort());
  assert.equal(p.headline.independent.precision, 0.5);
  assert.deepEqual(p.determinism, { clean: true, cases_checked: 2, drift: [] });
  assert.deepEqual(p.timing, report.timing);
});

test("qualityPayload fills a missing headline metric with null instead of throwing", () => {
  const report = fakeReport();
  delete report.headline.independent.precision;
  const p = qualityPayload(rootWithReport(report));
  assert.equal(p.headline.independent.precision, null);
});

test("/api/quality serves the shaped payload", () => {
  const ctx = { root: rootWithReport(fakeReport()) };
  const { handled, res, json } = call("/api/quality", ctx);
  assert.equal(handled, true);
  assert.equal(res.code, 200);
  assert.match(res.headers["content-type"], /application\/json/);
  assert.equal(json().available, true);
});

test("/api/quality reports unavailable with no report", () => {
  const ctx = { root: rootWithReport(null) };
  assert.deepEqual(call("/api/quality", ctx).json(), { available: false });
});

test("the Quality page and its module are served; unknown paths are left to the server", () => {
  const ctx = { root: rootWithReport(fakeReport()) };
  const page = call("/quality", ctx);
  assert.equal(page.res.code, 200);
  assert.match(page.res.headers["content-type"], /text\/html/);
  assert.match(page.res.body, /mountQuality/);
  const mod = call("/ui/quality.mjs", ctx);
  assert.equal(mod.res.code, 200);
  assert.match(mod.res.headers["content-type"], /javascript/);
  assert.equal(call("/api/examples", ctx).handled, false);
});
