// The structural-gate variant and the acceptance criteria that judge it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { getVariant, variantNames } from "./variants.mjs";
import { evaluateAcceptance, runtimeOverhead, splitOf } from "./acceptance.mjs";
import { listCaseDirs, loadCase } from "./adapter.mjs";
import { evaluateCase } from "./evaluate.mjs";
import { here } from "./util.mjs";
import { sumCounts, ratios } from "./metrics.mjs";

const load = (id) => listCaseDirs(here("cases")).map(loadCase).find((l) => l.id === id);

test("the structural-gate variant is registered with the acceptance criteria and its own generate()", () => {
  assert.ok(variantNames().includes("structural-gate"));
  const v = getVariant("structural-gate");
  assert.deepEqual(v.acceptance, { wrong_accept_reduction: 0.5, recall_drop_max: 0.02, questions_increase_max: 0.1, determinism: true });
  assert.equal(typeof v.generate, "function", "generated-file hashes must come from the pipeline with the flag on");
  assert.equal(getVariant("baseline").acceptance, undefined);
});

test("on a coincidence case the gate turns the confident wrong wirings into questions, and keeps what the design's words vouch for", async () => {
  const l = load("coincidence-spurious-03");
  const base = await evaluateCase(l, getVariant("baseline"), { workRoot: null, determinism: false });
  const gate = await evaluateCase(l, getVariant("structural-gate"), { workRoot: null, determinism: false });
  assert.equal(base.counts.wrong_accepts, 2);
  assert.equal(gate.counts.wrong_accepts, 0);
  assert.equal(gate.counts.questions, base.counts.questions + 2);
  assert.equal(gate.counts.correct_accepts, base.counts.correct_accepts, "itemCount = count() stays accepted: the design's word is 'count'");
  assert.equal(gate.counts.oracle_correct, gate.counts.oracle_total, "answering the questions with the truth still reaches the truth");
});

test("what the flag does not touch: an example with no flagged part scores exactly as the baseline", async () => {
  const l = load("example-products");
  const a = await evaluateCase(l, getVariant("baseline"), { workRoot: null, determinism: false });
  const b = await evaluateCase(l, getVariant("structural-gate"), { workRoot: null, determinism: false });
  assert.deepEqual(a.counts, b.counts);
});

test("the two halves of the corpus are a fixed split of the case ids", () => {
  const ids = listCaseDirs(here("cases")).map((d) => loadCase(d).id);
  const halves = ids.map(splitOf);
  assert.deepEqual(halves, ids.map(splitOf), "deterministic");
  assert.ok(halves.filter((h) => h === "derive").length >= 25 && halves.filter((h) => h === "heldout").length >= 25, "both halves are big enough to read");
  assert.equal(splitOf("coincidence-spurious-03"), "heldout");
});

const rec = (id, over = {}) => ({
  id, category: "c",
  counts: { screens: 1, parts: 10, uncertain: 0, d_parts: 10, accepts: 8, correct_accepts: 8 - (over.wrong ?? 0), wrong_accepts: over.wrong ?? 0, match_parts: 8, match_hits: 8 - (over.miss ?? 0), questions: 2 + (over.q ?? 0), questions_necessary: 0, questions_unnecessary: 0, questions_unknown: 0 },
  counts_by_label: { independent: { screens: 1, parts: 10, uncertain: 0, d_parts: 10, accepts: 8, correct_accepts: 8 - (over.wrong ?? 0), wrong_accepts: over.wrong ?? 0, match_parts: 8, match_hits: 8 - (over.miss ?? 0), questions: 2 + (over.q ?? 0), questions_necessary: 0, questions_unnecessary: 0, questions_unknown: 0 } },
  timing: { extract_ms: 1, analyze_ms: over.ms ?? 1 }, n_parts: 10,
});
const spec = { wrong_accept_reduction: 0.5, recall_drop_max: 0.02, questions_increase_max: 0.1, determinism: true };
const det = { drift: [], cases_checked: 20 };
const ids = Array.from({ length: 20 }, (_, i) => `case-${i}`);

test("acceptance: halving the wrong accepts with small changes elsewhere passes, on the ALL tier and on the independent tier", () => {
  const base = ids.map((id, i) => rec(id, { wrong: i < 4 ? 1 : 0 }));
  const good = ids.map((id) => rec(id, { wrong: 0, q: 0 }));
  const a = evaluateAcceptance({ baseRecs: base, varRecs: good, spec, determinism: det });
  assert.equal(a.verdict, "PASS");
  assert.deepEqual(a.criteria.map((c) => c.pass), [true, true, true, true]);
  assert.equal(a.tiers.independent.verdict, "PASS");
  assert.deepEqual(Object.keys(a.tiers).sort(), ["derive", "heldout", "independent"]);
});

test("acceptance: each criterion fails on its own (recall, questions, determinism, too few wrong accepts removed)", () => {
  const base = ids.map((id, i) => rec(id, { wrong: i < 4 ? 1 : 0 }));
  const verdictOf = (vars, d = det) => evaluateAcceptance({ baseRecs: base, varRecs: vars, spec, determinism: d });
  const fails = (a) => a.criteria.filter((c) => !c.pass).map((c) => c.criterion.split(" ")[0]);
  assert.deepEqual(fails(verdictOf(ids.map((id, i) => rec(id, { wrong: i < 3 ? 1 : 0 })))), ["wrong-accept"], "4 -> 3 is not half");
  assert.deepEqual(fails(verdictOf(ids.map((id, i) => rec(id, { wrong: 0, miss: i < 4 ? 1 : 0 })))), ["recall"], "4 of 160 hits lost is more than 2 points");
  assert.deepEqual(fails(verdictOf(ids.map((id, i) => rec(id, { wrong: 0, q: i < 5 ? 1 : 0 })))), ["questions"], "5 more questions on 40");
  assert.deepEqual(fails(verdictOf(ids.map((id) => rec(id)), { drift: [{ case: "x" }], cases_checked: 20 })).includes("determinism:"), true);
  assert.equal(verdictOf(base).verdict, "FAIL", "no wrong-accept reduction at all");
});

test("acceptance: the runtime overhead is reported per screen and per 1000 parts, and is not judged", () => {
  const o = runtimeOverhead(ids.map((id) => rec(id, { ms: 1 })), ids.map((id) => rec(id, { ms: 3 })));
  assert.deepEqual([o.added_ms_per_screen, o.added_ms_per_1000_parts, o.screens, o.parts], [2, 200, 20, 200]);
});

test("the summed counts of a tier give the same ratios the report prints", () => {
  const r = ratios(sumCounts(ids.map((id) => rec(id, { wrong: 1 }).counts)));
  assert.equal(r.wrong_accepts, 20);
  assert.equal(r.questions_per_screen, 2);
});
