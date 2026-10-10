// LIN-248 (CHANGELOG.md: "lookup-object (LOOKUP[x]) case parsing (parseLookupObject) is implemented to spec but
// has no exercising fixture in examples/orders"): a `LOOKUP[x]`-style switch part (orders' header now carries
// `STATUS_BADGE[status]`, alongside the pre-existing chained-ternary "Switch: orderCount" part) offers the same
// rule-default "Make it a switch" option as the ternary-chain case, but every case comes back verdict "fit" (a
// lookup object has no gap branches, unlike a ternary chain's range comparisons) and `default` is always null (a
// lookup object has no trailing else, unlike a ternary chain's final branch) -- options.mjs:231/233.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeState, readAnswers } from "./state.mjs";
import { buildForm, parseLookupObject, scopeOf } from "./options.mjs";
import { resolveChoice } from "./inspect.mjs";
import { applyChanges, undo } from "./history.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// A clean copy of an example (no answers, no history) inside a temporary examples folder -- same helper
// inspector.test.mjs's LIN-201 test uses.
function fixture(name) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "trace-options-"));
  const dir = path.join(base, "examples", name);
  fs.cpSync(path.join(root, "examples", name), dir, { recursive: true });
  for (const f of ["answers.json", "decisions.json", "ai-cache.json", "answers.history.jsonl"]) fs.rmSync(path.join(dir, f), { force: true });
  return dir;
}

test("LIN-248: a LOOKUP[x] switch part (orders' STATUS_BADGE[status]) offers 'Make it a switch' with all-fit cases and no default, applied and undone like any other part", async () => {
  const dir = fixture("orders");
  const st = await computeState(dir);
  const switchParts = st.parts.filter((p) => p.exprKind === "switch");
  const lookupPart = switchParts.find((p) => p.exprCondition === "status");
  const ternaryPart = switchParts.find((p) => p.exprCondition === "orderCount");
  assert.ok(lookupPart, "the header's STATUS_BADGE[status] lookup is detected as its own switch part");
  assert.ok(ternaryPart, "the pre-existing chained-ternary switch part (orderCount) is still detected, distinct from the lookup one");
  assert.equal(lookupPart.label, "Switch: status");

  const form = buildForm(st, lookupPart.id);
  assert.equal(form.scope, "exprkind");
  assert.equal(form.options.length, 1, "exactly one option: the rule default itself");
  const opt = form.options[0];
  assert.equal(opt.label, "Make it a switch");
  assert.equal(opt.ruleDefault, true);

  const body = opt.value; // exprBody spread into the option's own value (options.mjs:254)
  assert.ok(Array.isArray(body.cases));
  const shipped = body.cases.find((c) => c.match === "Shipped");
  const pending = body.cases.find((c) => c.match === "Pending");
  assert.ok(shipped, "a 'Shipped' case is parsed from STATUS_BADGE");
  assert.ok(pending, "a 'Pending' case is parsed from STATUS_BADGE");
  assert.equal(shipped.verdict, "fit", "a lookup-object case is always a fit (options.mjs:231), never a gap");
  assert.equal(pending.verdict, "fit");
  assert.equal(body.default, null, "a lookup object has no trailing default, unlike a ternary chain (options.mjs:233)");

  const picked = resolveChoice(st, lookupPart.id, { option: opt.id });
  applyChanges(dir, [{ id: lookupPart.id, value: picked.value }], { source: "inspector" });
  assert.deepEqual(readAnswers(dir)[lookupPart.id], picked.value);
  const st2 = await computeState(dir, { answers: readAnswers(dir) });
  const form2 = buildForm(st2, lookupPart.id);
  assert.equal(form2.options[0].current, true, "applying shows up as the current pick, same as any other part");

  assert.equal(undo(dir, lookupPart.id).ids[0], lookupPart.id);
  assert.deepEqual(readAnswers(dir)[lookupPart.id], undefined, "undo reverts it, same as any other part's history entry");
});

// parseLookupObject's own edge cases, cheaply, against small inline source strings -- no fixture needed. Exported
// from options.mjs (additive; it had no exported name before) specifically so these can be checked directly.
test("parseLookupObject: unknown var name, malformed object, single- and multi-entry objects", () => {
  const src = 'const X = { "a": 1, "b": 2 };';
  assert.equal(parseLookupObject(src, "NOPE"), null, "a variable name with no matching `const <name> = {` literal is never guessed");

  const unterminated = 'const X = { "a": 1, "b": 2 ';
  assert.equal(parseLookupObject(unterminated, "X"), null, "an unterminated object (no matching closing brace) comes back null, never a partial parse");

  const single = parseLookupObject('const ONE = { "only": "value" };', "ONE");
  assert.deepEqual(single, { cases: [{ match: "only", branch: "value", verdict: "fit" }], default: null });

  const multi = parseLookupObject(src, "X");
  assert.deepEqual(multi, {
    cases: [
      { match: "a", branch: "1", verdict: "fit" },
      { match: "b", branch: "2", verdict: "fit" },
    ],
    default: null,
  });
});

// LIN-252 (CHANGELOG.md's follow-up: "a pagemap element/text-node id still cannot be opened in the Part
// inspector") -- closes that gap's test coverage. LIN-158 already wires a flagged pagemap id into st.parts
// (state.mjs) and options.mjs's buildForm already maps its unclassified/ambiguous kind to the data-or-copy
// form; inspector.test.mjs covers the end-to-end HTTP path, but nothing exercised options.mjs's own
// scopeOf/buildForm directly for a pagemap-origin id.
test("LIN-252: a pagemap-origin id (unclassified text node, products-no-contract) opens via scopeOf/buildForm like any other part", async () => {
  const dir = fixture("products-no-contract");
  const st = await computeState(dir);
  const pagemapPart = st.parts.find((p) => p.pagemap);
  assert.ok(pagemapPart, "the fixture's page pagemap flags at least one unclassified/ambiguous id");

  assert.deepEqual(scopeOf(st, pagemapPart.id), { scope: "text", name: pagemapPart.id });

  const form = buildForm(st, pagemapPart.id);
  assert.equal(form.form, "data-or-copy");
  assert.equal(form.scope, "text");
  const data = form.options.find((o) => o.id === "data");
  const copy = form.options.find((o) => o.id === "copy");
  assert.ok(data, "a pagemap-origin id's form offers 'Data from the API'");
  assert.ok(copy, "a pagemap-origin id's form offers 'Fixed copy'");
});
