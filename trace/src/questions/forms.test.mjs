// The question-form registry: stable ids, the exact wording of the older forms, and the confirm-or-pick form.
import { test } from "node:test";
import assert from "node:assert/strict";
import { FORMS, formIds, formText, formOptions, partFormId, withTail } from "./forms.mjs";
import { describeField, describeValue, buildQuestions } from "../ask.mjs";

test("every form has a stable id, a type and a plain template", () => {
  assert.deepEqual(formIds().sort(), ["action-kind", "confirm-or-pick", "handler-name", "keep-or-change", "no-source", "pick-one", "pick-sort", "placeholder-fields", "placeholder-name", "placeholder-source"]);
  for (const [k, f] of Object.entries(FORMS)) {
    assert.equal(f.id, k);
    assert.ok(["choice", "multi", "text"].includes(f.type));
    assert.equal(typeof f.text, "function");
    assert.ok(f.describe.length > 10);
  }
});

const cand = (field, formatter = "asText") => ({ field, formatter, cost: formatter === "asText" ? 0 : 1 });
const ctx = {
  scope: "row", name: "rank", example: "1", candidates: [cand("id")], describe: describeField,
  alternatives: [cand("position"), cand("order", "moneyCompact")],
  risk: 'the design shows a running number (1, 2, 3, 4) and "id" also runs one by one down the mock list; the design\'s words ("#") do not appear in the field name',
  samples: '"1", "2", "3"',
};

test("confirm-or-pick: A confirm, B the ranked others, C a gap (in that order)", () => {
  const o = formOptions("confirm-or-pick", ctx);
  assert.deepEqual(o.map((x) => x.label), [
    'Confirm: API field "id"',
    'Pick instead: API field "position"',
    'Pick instead: API field "order" shown as moneyCompact',
    "Leave it as a gap — a TODO to answer later",
  ]);
  assert.deepEqual(o[0].value, ctx.candidates[0]);
  assert.deepEqual(o.at(-1).value, { todo: true });
});

test("confirm-or-pick: the question says what matched, why it may be a coincidence, and what the design shows", () => {
  assert.equal(formText("confirm-or-pick", ctx), 'Row part "rank" (e.g. "1") matched API field "id", but that could be a coincidence: ' + ctx.risk + '. The design shows "1", "2", "3". Confirm it, pick another explanation, or leave it as a gap?');
  const value = { scope: "value", name: "openCount", example: "8", candidates: [{ agg: "count", field: null, formatter: "asText", cost: 1 }], describe: describeValue, alternatives: [], risk: "R", samples: '"8"' };
  assert.equal(formText("confirm-or-pick", value), '"openCount" (shows "8") matched count of the list, but that could be a coincidence: R. The design shows "8". Confirm it, pick another explanation, or leave it as a gap?');
  assert.deepEqual(formOptions("confirm-or-pick", value).map((x) => x.label), ["Confirm: count of the list", "Leave it as a gap — a TODO to answer later"]);
});

test("which form applies", () => {
  assert.equal(partFormId({ candidates: [1, 2] }), "pick-one");
  assert.equal(partFormId({ candidates: [] }), "no-source");
  assert.equal(partFormId({ candidates: [1], all: true }), "keep-or-change");
  assert.equal(partFormId({ candidates: [1] }), null, "one candidate, nothing to ask");
  assert.equal(partFormId({ candidates: [1], flagged: true }), "confirm-or-pick");
  assert.equal(partFormId({ candidates: [1], flagged: true, all: true }), "confirm-or-pick", "the flag's reason wins over --ask-all");
  assert.equal(partFormId({ candidates: [1, 2], flagged: true }), "pick-one", "a tie is a tie first");
});

test("the older forms keep their exact wording", () => {
  assert.equal(formText("pick-one", { scope: "value", name: "total", example: "$5", candidates: [1, 2] }), '"total" (shows "$5") can be computed more than one way from the mock data. Which is meant?');
  assert.equal(formText("pick-one", { scope: "row", name: "owner", example: "Ann", candidates: [1, 2] }), 'Row part "owner" (e.g. "Ann") matches more than one API field, and the mock data can\'t tell them apart. Which one is meant?');
  assert.equal(formText("no-source", { scope: "row", name: "rank", example: "1", candidates: [] }), 'Row part "rank" (e.g. "1") can\'t be produced from any API field. What is it?');
  assert.equal(formText("no-source", { scope: "value", name: "t", example: "1", candidates: [], blockWhy: "No contract." }), '"t" (shows "1") can\'t be computed from the mock data. No contract. What is it?');
  assert.equal(formText("keep-or-change", { ...ctx, candidates: [cand("budget", "moneyCompact")], name: "budget", example: "$2.0K" }), 'Row part "budget" (e.g. "$2.0K") matched API field "budget" shown as moneyCompact. Keep that, or choose something else?');
  assert.equal(formText("pick-sort", { name: "orders", sorts: [] }), 'The designed row order matches more than one sort on the mock data. How should "orders" be sorted?');
  assert.equal(formText("action-kind", { name: "save", scope: "page", kind: "save", missing: [], possible: [], labels: {} }), '"save" looks like "save". Keep that, or choose something else?');
  assert.equal(formText("action-kind", { name: "x", scope: "row", kind: null, missing: [], possible: [], labels: {} }), 'What should the "x" row action do?');
  assert.equal(formText("placeholder-name", { part: "rank" }), 'What should the placeholder function for "rank" be called?');
  assert.deepEqual(withTail([{ label: "a", value: 1 }]).map((o) => o.label), ["a", "static text — not data"]);
});

test("buildQuestions: with no structural flag, questions are what they always were (same ids, order, text, option labels)", () => {
  const m = {
    endpoints: { list: { method: "GET", path: "/api/x", response: [{ id: 1, name: "A" }] }, listKey: null },
    list: { name: "x", fields: [{ name: "rank", examples: ["1"], candidates: [cand("id")] }, { name: "name", examples: ["A"], candidates: [cand("name"), cand("id")] }], sort: [{ field: null, dir: "none", label: "keep the API order" }], actions: [] },
    values: [{ name: "total", example: "1", candidates: [] }], actions: [], forms: [], gaps: [],
  };
  const qs = buildQuestions(m);
  assert.deepEqual(qs.map((q) => q.id), ["list.name", "value.total"], "a single candidate is not asked without --ask-all or a flag");
  assert.equal(qs[0].form, "pick-one");
  assert.equal(qs[1].form, "no-source");
  assert.deepEqual(qs[1].options.map((o) => o.label).slice(0, 2), ["data the API doesn't provide yet — leave a TODO", "static text — not data"]);
  assert.equal(buildQuestions(m, { all: true }).find((q) => q.id === "list.rank").form, "keep-or-change");
});
