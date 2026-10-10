import test from "node:test";
import assert from "node:assert/strict";
import { pctS, renderDeterminism, renderHeadline, renderPage, renderTiming } from "./quality.mjs";

const tier = (over = {}) => ({ precision: 0.8, recall: 0.7, f1: 0.75, wrong_accept_rate: 0.05, coincidence_catch_rate: 0.9, questions_per_screen: 1.4, unnecessary_question_rate: 0.02, oracle_accuracy: 0.95, coupled_excess: 0, library_miss_rate: 0.01, ...over });

const data = (over = {}) => ({
  available: true,
  variant: "baseline",
  cases: 42,
  report_hash: "abc123def456",
  headline: { all: tier(), independent: tier({ precision: 0.6 }), reference: tier(), self: tier() },
  determinism: { clean: true, cases_checked: 10, drift: [] },
  timing: { case_analyze_ms: { p50: 12.3, p95: 40.1 }, case_pipeline_ms: { p50: 30, p95: 90.5 } },
  ...over,
});

test("pctS formats a ratio as a whole percent, or n/a for null", () => {
  assert.equal(pctS(0.5), "50%");
  assert.equal(pctS(1), "100%");
  assert.equal(pctS(null), "n/a");
});

test("renderHeadline shows independent-truth values with the all-cases value alongside", () => {
  const h = renderHeadline(data().headline);
  assert.match(h, /Precision/);
  assert.match(h, /60%/); // independent
  assert.match(h, /80%/); // all, in parens
});

test("renderDeterminism shows a clean chip when there is no drift", () => {
  const h = renderDeterminism({ clean: true, cases_checked: 10, drift: [] });
  assert.match(h, /Clean/);
  assert.match(h, /10 case/);
});

test("renderDeterminism lists unexpected drift cases when not clean", () => {
  const h = renderDeterminism({ clean: false, cases_checked: 10, drift: [{ case: "a-1", check: "repeat", files: [], questions_changed: true, predictions_changed: false }] });
  assert.match(h, /1 unexpected drift/);
  assert.match(h, /a-1/);
  assert.match(h, /repeat/);
});

test("renderTiming shows p50/p95 for both stages", () => {
  const h = renderTiming(data().timing);
  assert.match(h, /12\.30 ms/);
  assert.match(h, /90\.50 ms/);
});

test("renderPage shows the empty state when no eval has run yet", () => {
  const h = renderPage({ available: false });
  assert.match(h, /No eval report yet/);
  assert.match(h, /npm run eval:baseline/);
});

test("renderPage renders variant, case count and hash plus all three sections when available", () => {
  const h = renderPage(data());
  assert.match(h, /baseline/);
  assert.match(h, /42/);
  assert.match(h, /abc123def456/);
  assert.match(h, /Headline/);
  assert.match(h, /Determinism/);
  assert.match(h, /Runtime/);
});
