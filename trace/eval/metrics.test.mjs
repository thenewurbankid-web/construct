import { test } from "node:test";
import assert from "node:assert/strict";
import { scorePart, countsFrom, sumCounts, ratios, f1, ece, coverageAccuracy, aiMetrics, percentile, scalingExponent } from "./metrics.mjs";

const part = (o) => ({ id: "list.x", cls: "row", outcome: "accept", accepted: "f:a|asText", default: null, options: [], candidates: ["f:a|asText"], ...o });
const truth = (o) => ({ kind: "match", want: "f:a|asText", ...o });

test("a correct accept, a wrong accept and a question are told apart", () => {
  const ok = scorePart(part({}), truth({}));
  assert.equal(ok.correct, true);
  const bad = scorePart(part({ accepted: "f:b|asText" }), truth({}));
  assert.equal(bad.wrong, true);
  const asked = scorePart(part({ outcome: "ask", accepted: null, options: ["f:a|asText", "f:b|asText"], default: "f:a|asText", candidates: ["f:a|asText", "f:b|asText"] }), truth({ kind: "needs-answer" }));
  assert.equal(asked.asked, true);
  assert.equal(asked.necessary, false, "the default was already the answer");
  const asked2 = scorePart(part({ outcome: "ask", accepted: null, options: ["f:b|asText", "f:a|asText"], default: "f:b|asText" }), truth({ kind: "needs-answer" }));
  assert.equal(asked2.necessary, true);
});

test("uncertain and unlabelled parts are excluded, and only counted", () => {
  const v = [scorePart(part({}), truth({ uncertain: "design decision" })), scorePart(part({ id: "list.y" }), undefined), scorePart(part({}), truth({}))];
  const c = countsFrom(v);
  assert.equal(c.uncertain, 1);
  assert.equal(c.unlabelled, 1);
  assert.equal(c.parts, 1);
});

test("wrong-accept rate counts confident wrong parts per data part; precision and recall follow", () => {
  const verdicts = [
    scorePart(part({ id: "a" }), truth({})), // right
    scorePart(part({ id: "b", accepted: "f:z|asText" }), truth({ kind: "gap", want: "gap:todo" })), // wrong: a gap wired to a field
    scorePart(part({ id: "c", outcome: "ask", accepted: null, options: [], default: null }), truth({})), // a match Trace failed to wire
    scorePart(part({ id: "d", cls: "action", accepted: "x:remove" }), truth({ want: "x:remove" })), // actions are not data parts
  ];
  const r = ratios(countsFrom(verdicts));
  assert.equal(r.wrong_accept_rate, 1 / 3);
  assert.equal(r.precision, 1 / 2);
  assert.equal(r.recall, 1 / 2);
  assert.equal(r.f1, 1 / 2);
});

test("coincidence catch: a wrong wiring is a miss, a question is a catch", () => {
  const spurious = truth({ kind: "gap", want: "gap:custom", coincidence: true });
  const missed = scorePart(part({ id: "a" }), spurious);
  const caught = scorePart(part({ id: "b", outcome: "ask", accepted: null, options: ["f:a|asText"], default: "f:a|asText" }), spurious);
  const r = ratios(countsFrom([missed, caught]));
  assert.equal(r.coincidence_catch_rate, 0.5);
});

test("coupled ties: k questions in one group are k-1 more than needed", () => {
  const t = (id) => scorePart(part({ id, outcome: "ask", accepted: null, options: ["f:a|asText"], default: "f:a|asText" }), truth({ kind: "needs-answer", couple: "g" }));
  const r = ratios(countsFrom([t("p1"), t("p2"), t("p3")]));
  assert.equal(r.coupled_excess, 2);
});

test("oracle accuracy compares the final wiring with the truth", () => {
  const v = [scorePart(part({ id: "a" }), truth({})), scorePart(part({ id: "b" }), truth({}))];
  const c = countsFrom(v, { a: truth({}), b: truth({}) }, { a: "f:a|asText", b: "f:zzz|asText" });
  assert.equal(ratios(c).oracle_accuracy, 0.5);
});

test("questions whose gap resolution was never recorded are left out of necessity", () => {
  const v = scorePart(part({ outcome: "ask", accepted: null, options: ["gap:todo"], default: "gap:todo" }), truth({ kind: "gap", want: "gap:todo", resolutionUnknown: true }));
  const c = countsFrom([v]);
  assert.equal(c.questions, 1);
  assert.equal(c.questions_unknown, 1);
  assert.equal(ratios(c).unnecessary_question_rate, null);
});

test("sumCounts adds every field; f1 handles empties", () => {
  const a = countsFrom([scorePart(part({}), truth({}))]);
  assert.equal(sumCounts([a, a]).accepts, 2);
  assert.equal(sumCounts([a, a]).screens, 2);
  assert.equal(f1(null, 1), null);
  assert.equal(f1(0, 0), null);
});

test("ECE and the coverage-accuracy curve", () => {
  const perfect = [{ confidence: 1, correct: true }, { confidence: 0.0, correct: false }];
  assert.equal(ece(perfect), 0);
  const overconfident = [{ confidence: 0.9, correct: false }, { confidence: 0.9, correct: false }];
  assert.ok(Math.abs(ece(overconfident) - 0.9) < 1e-9);
  const curve = coverageAccuracy([{ confidence: 0.9, correct: true }, { confidence: 0.5, correct: false }], 4);
  assert.deepEqual(curve, [{ threshold: 0.9, coverage: 0.25, accuracy: 1 }, { threshold: 0.5, coverage: 0.5, accuracy: 0.5 }]);
});

test("AI metrics: accuracy of accepted, abstention, no calibration without confidence", () => {
  const m = aiMetrics([{ accepted: true, correct: true, tokens: 10, ms: 5 }, { accepted: true, correct: false, tokens: 10, ms: 5 }, { accepted: false, correct: false }]);
  assert.equal(m.accuracy_of_accepted, 0.5);
  assert.ok(Math.abs(m.abstention_rate - 1 / 3) < 1e-9);
  assert.equal(m.ece, null);
  assert.equal(m.tokens, 20);
});

test("percentiles and the scaling exponent", () => {
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50), 5);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
  const linear = scalingExponent([{ size: 10, ms: 10 }, { size: 100, ms: 100 }, { size: 1000, ms: 1000 }]);
  const quad = scalingExponent([{ size: 10, ms: 100 }, { size: 100, ms: 10000 }]);
  assert.ok(Math.abs(linear - 1) < 1e-9);
  assert.ok(Math.abs(quad - 2) < 1e-9);
});
