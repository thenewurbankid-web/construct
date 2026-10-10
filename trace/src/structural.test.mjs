// Structural-coincidence detectors: one per pattern, with the real cases the eval corpus produced and adversarial
// ones (look like the pattern, must not fire; or must fire although they look innocent).
import { test } from "node:test";
import assert from "node:assert/strict";
import { countEqualsRowCount, sequenceEqualsIdOrIndex, extremumIsOverallExtreme, smallNumberFromEnvelope, detectStructural, DETECTORS, PATTERNS, NEXT_STEP } from "./structural.mjs";

const cnt = { agg: "count", field: null, formatter: "asText", cost: 1 };
const items = (n, f = (i) => ({ id: i + 1, balance: 100 + i })) => Array.from({ length: n }, (_, i) => f(i));

test("every detector is registered once, has a pattern name and a next step", () => {
  assert.equal(DETECTORS.length, PATTERNS.length);
  assert.deepEqual(Object.keys(NEXT_STEP).sort(), [...PATTERNS].sort());
  const seen = new Set();
  for (const p of PATTERNS) { assert.ok(!seen.has(p)); seen.add(p); assert.match(NEXT_STEP[p], /^\S/); }
});

// ---- count-equals-row-count
test("count: a count() candidate is flagged, with the mock list size in the reason (real: coincidence-spurious openCount = 8)", () => {
  const hit = countEqualsRowCount({ candidate: cnt, examples: ["8"], itemCount: 8 });
  assert.equal(hit.pattern, "count-equals-row-count");
  assert.match(hit.reason, /"8"/);
  assert.match(hit.reason, /\(8\)/);
});
test("count: adversarial. A sum() that happens to equal the row count is not this pattern; a count with a formatter still is", () => {
  assert.equal(countEqualsRowCount({ candidate: { agg: "sum", field: "stock", formatter: "asText" }, examples: ["8"], itemCount: 8 }), null);
  assert.equal(countEqualsRowCount({ candidate: { field: "count", formatter: "asText" }, examples: ["8"], itemCount: 8 }), null, "a FIELD named count is a field, not the row count");
  assert.ok(countEqualsRowCount({ candidate: { ...cnt, formatter: "moneyCompact" }, examples: ["$8"], itemCount: 8 }));
});

// ---- sequence-equals-id-or-index
test("sequence: 1..4 matched by an auto-increment id is flagged (real: coincidence-spurious rank)", () => {
  const hit = sequenceEqualsIdOrIndex({ candidate: { field: "id", formatter: "asText" }, examples: ["1", "2", "3", "4"], values: [1, 2, 3, 4, 5, 6] });
  assert.equal(hit.pattern, "sequence-equals-id-or-index");
  assert.match(hit.reason, /running number \(1, 2, 3, 4\)/);
});
test("sequence: zero-padded, #-prefixed and 0-based runs count; so does a non-id field that runs one by one (the row index in disguise)", () => {
  assert.ok(sequenceEqualsIdOrIndex({ candidate: { field: "id" }, examples: ["01", "02", "03"], values: [1, 2, 3] }));
  assert.ok(sequenceEqualsIdOrIndex({ candidate: { field: "id" }, examples: ["#1", "#2"], values: [1, 2, 3] }));
  assert.ok(sequenceEqualsIdOrIndex({ candidate: { field: "id" }, examples: ["0", "1", "2"], values: [0, 1, 2] }));
  assert.ok(sequenceEqualsIdOrIndex({ candidate: { field: "position" }, examples: ["1", "2", "3"], values: [1, 2, 3, 4] }));
  assert.ok(sequenceEqualsIdOrIndex({ candidate: { field: "meta.uuid" }, examples: ["1", "2", "3"], values: ["a", "b", "c"] }), "an id-named field is flagged even when its values are not numbers");
});
test("sequence: adversarial. Not a running number, not from 0/1, a gap, a single row, or an ordinary field: no flag", () => {
  const c = { field: "id" };
  assert.equal(sequenceEqualsIdOrIndex({ candidate: c, examples: ["3", "4", "5"], values: [3, 4, 5] }), null, "starts at 3");
  assert.equal(sequenceEqualsIdOrIndex({ candidate: c, examples: ["1", "3", "4"], values: [1, 3, 4] }), null, "has a gap");
  assert.equal(sequenceEqualsIdOrIndex({ candidate: c, examples: ["1"], values: [1, 2] }), null, "one row is not a sequence");
  assert.equal(sequenceEqualsIdOrIndex({ candidate: { field: "stock" }, examples: ["1", "2", "3"], values: [1, 5, 2, 9] }), null, "an ordinary field that happens to read 1,2,3 on the designed rows");
  assert.equal(sequenceEqualsIdOrIndex({ candidate: { field: "name" }, examples: ["Ann", "Bo"], values: ["Ann", "Bo"] }), null);
  assert.equal(sequenceEqualsIdOrIndex({ candidate: { agg: "max", field: "id" }, examples: ["1", "2"], values: [1, 2] }), null, "an aggregate is not a column field");
});

// ---- extremum-is-overall-extreme
test("extremum: max and min candidates are flagged, naming the row the extreme is on (real: topOpen = max(balance))", () => {
  const list = items(8);
  const hit = extremumIsOverallExtreme({ candidate: { agg: "max", field: "balance" }, items: list });
  assert.equal(hit.pattern, "extremum-is-overall-extreme");
  assert.match(hit.reason, /largest "balance" of ALL 8 mock rows \(row 8\)/);
  assert.match(extremumIsOverallExtreme({ candidate: { agg: "min", field: "balance" }, items: list }).reason, /smallest "balance".*\(row 1\)/);
});
test("extremum: adversarial. sum, average and count are not extremes", () => {
  for (const agg of ["sum", "average", "count", "field"]) assert.equal(extremumIsOverallExtreme({ candidate: { agg, field: "balance" }, items: items(3) }), null, agg);
  assert.equal(extremumIsOverallExtreme({ candidate: { field: "balance" }, items: items(3) }), null, "a plain column field");
});

// ---- small-number-from-envelope
test("small number: a bare whole number up to three digits matched to an envelope field is flagged (real: coveredCount = 21)", () => {
  const hit = smallNumberFromEnvelope({ candidate: { agg: "field", field: "portfolio.resilience_initiatives.total" }, examples: ["21"] });
  assert.equal(hit.pattern, "small-number-from-envelope");
  assert.match(hit.reason, /"21"/);
});
test("small number: adversarial. Four digits, a formatted number, text and a non-envelope candidate are not flagged", () => {
  const env = { agg: "field", field: "meta.total" };
  assert.equal(smallNumberFromEnvelope({ candidate: env, examples: ["1234"] }), null);
  assert.equal(smallNumberFromEnvelope({ candidate: env, examples: ["$21"] }), null);
  assert.equal(smallNumberFromEnvelope({ candidate: env, examples: ["21 items"] }), null);
  assert.equal(smallNumberFromEnvelope({ candidate: env, examples: ["Ready"] }), null);
  assert.equal(smallNumberFromEnvelope({ candidate: { field: "stock" }, examples: ["21"] }), null, "a list column, not an envelope field");
  assert.equal(smallNumberFromEnvelope({ candidate: { agg: "sum", field: "stock" }, examples: ["21"] }), null);
});

// ---- the set
test("detectStructural: the first rule that fires names the flag; an unremarkable match has none", () => {
  assert.equal(detectStructural({ candidate: cnt, examples: ["8"], items: items(8), itemCount: 8, values: [] }).pattern, "count-equals-row-count");
  assert.equal(detectStructural({ candidate: { field: "name", formatter: "asText" }, examples: ["Ann", "Bo"], items: items(2), itemCount: 2, values: ["Ann", "Bo"] }), null);
  assert.equal(detectStructural({ candidate: { agg: "sum", field: "balance", formatter: "moneyCompact" }, examples: ["$1.0K"], items: items(3), itemCount: 3, values: [] }), null);
});
test("the detectors are pure: same input, same output, and the input is not changed", () => {
  const input = { candidate: { agg: "max", field: "balance" }, items: items(5), examples: ["$1"], itemCount: 5, values: [] };
  const before = JSON.stringify(input);
  const a = detectStructural(input), b = detectStructural(input);
  assert.deepEqual(a, b);
  assert.equal(JSON.stringify(input), before);
});
