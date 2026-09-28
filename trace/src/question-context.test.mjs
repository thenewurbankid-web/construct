// A part answered with "something else - build a placeholder" has a custom candidate: no API field, no formatter.
// It must not be listed as an API field, and nothing in the composed email may say "undefined".
import { test } from "node:test";
import assert from "node:assert/strict";
import { questionContext } from "./question-context.mjs";
import { composeEmail } from "./actions.mjs";

const spec = { feature: "orders", apis: [{ method: "GET", path: "/api/orders" }] };
const custom = { custom: true, from: "fields", inputs: ["first", "last"], fn: "fullName" };
const real = { field: "first", formatter: "text" };
const matched = () => ({
  endpoints: { list: { method: "GET", path: "/api/orders", response: { orders: [{ first: "Lena", last: "Kumar", total: 12 }, { first: "Arjun", last: "Rao", total: 9 }], sum: 21, label: "All" } }, listKey: "orders" },
  list: { alignedIdx: [0, 1], sort: [], fields: [{ name: "fullName", examples: ["Lena Kumar", "Arjun Rao"], candidates: [custom] }, { name: "first", examples: ["Lena"], candidates: [real] }] },
  values: [{ name: "grandTotal", example: "21", candidates: [{ custom: true, from: "controller", inputs: [], fn: "getGrandTotal" }] }],
  forms: [], gaps: [],
});

test("a custom placeholder candidate is not listed as an API field; the API fields are offered instead", () => {
  const c = questionContext({ id: "list.fullName" }, matched(), spec);
  assert.deepEqual(c.candidates, []);
  assert.deepEqual(c.available.map((a) => a.label), ["first", "last", "total"]);
  assert.ok(!JSON.stringify(c).includes("undefined"), JSON.stringify(c));
  const v = questionContext({ id: "value.grandTotal" }, matched(), spec);
  assert.deepEqual(v.candidates, []);
  assert.deepEqual(v.available.map((a) => a.label), ["sum", "label"]);
  assert.ok(!JSON.stringify(v).includes("undefined"));
});

test("a real candidate is still listed with its samples", () => {
  const c = questionContext({ id: "list.first" }, matched(), spec);
  assert.equal(c.candidates.length, 1);
  assert.match(c.candidates[0].label, /^first · /);
  assert.deepEqual(c.available, []);
});

test("the composed email has no 'undefined' for a custom placeholder item", () => {
  const item = (id, team = "backend") => ({ id, part: id, team, state: "missing", title: `${id} is a stub`, why: "w", next: "n", detail: "d", ctx: questionContext({ id }, matched(), spec) });
  const mail = composeEmail({ key: "backend", label: "Backend / API", scope: "the API", items: [item("list.fullName"), item("value.grandTotal")] }, "orders", spec);
  assert.doesNotMatch(mail.subject + "\n" + mail.body, /undefined/);
  assert.match(mail.body, /What the API returns today: first: Lena, last: Kumar, total: 12/);
  assert.doesNotMatch(mail.body, /Candidates:/);
});
