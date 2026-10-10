// A part answered with "something else - build a placeholder" has a custom candidate: no API field, no formatter.
// It must not be listed as an API field, and nothing in the composed email may say "undefined".
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { questionContext } from "./question-context.mjs";
import { composeEmail } from "./actions.mjs";
import { runPipeline } from "./pipeline.mjs";
import { resetExample } from "./reset.mjs";

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

// LIN-117 §3: the raw API field name travels alongside the display label, so the client can render one field
// row per candidate (a specific drop target) without having to parse it back out of the label text.
test("a real candidate carries its raw API field name, not just the display label (LIN-117 §3)", () => {
  const c = questionContext({ id: "list.first" }, matched(), spec);
  assert.equal(c.candidates[0].field, "first");
});

test("the composed email has no 'undefined' for a custom placeholder item", () => {
  const item = (id, team = "backend") => ({ id, part: id, team, state: "missing", title: `${id} is a stub`, why: "w", next: "n", detail: "d", ctx: questionContext({ id }, matched(), spec) });
  const mail = composeEmail({ key: "backend", label: "Backend / API", scope: "the API", items: [item("list.fullName"), item("value.grandTotal")] }, "orders", spec);
  assert.doesNotMatch(mail.subject + "\n" + mail.body, /undefined/);
  assert.match(mail.body, /What the API returns today: first: Lena, last: Kumar, total: 12/);
  assert.doesNotMatch(mail.body, /Candidates:/);
});

test("questionContext: ctx.criterion is the matching acceptance criterion when a story is given", () => {
  const story = { goal: "As a manager, I want to see totals.", criteria: ["Owner is the project lead.", "Full name is shown for each row."] };
  const c = questionContext({ id: "list.fullName" }, matched(), spec, story);
  assert.deepEqual(c.criterion, { id: "criterion-1", text: "Full name is shown for each row." });
});

test("questionContext: ctx.criterion is null with no story argument, or a story with no matching criterion", () => {
  const noStory = questionContext({ id: "list.fullName" }, matched(), spec);
  assert.equal(noStory.criterion, null);
  const story = { goal: "", criteria: ["Owner is the project lead."] };
  const noMatch = questionContext({ id: "list.fullName" }, matched(), spec, story);
  assert.equal(noMatch.criterion, null);
});

// LIN-109 [TR-14] end to end: pipeline.mjs loads the example's story.md and threads it into questionContext,
// so an Ask for a part named in an acceptance criterion carries that criterion id/text on the wire (the
// emitted "question" event's context.criterion), not just in the questionContext() unit above.
test("pipeline: an Ask for a part named in a criterion carries the criterion id end to end", async () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lm-qctx-"));
  fs.cpSync(path.join(root, "examples", "contacts"), dir, { recursive: true });
  resetExample(dir);
  const events = [];
  await runPipeline({
    dir,
    outRoot: fs.mkdtempSync(path.join(os.tmpdir(), "lm-qctx-out-")),
    auto: false,
    interactive: false,
    prompt: (q) => Promise.resolve((q.options ?? [])[0] ?? q.default ?? null),
    emit: (type, data) => events.push({ type, data }),
  });
  const nameQ = events.find((e) => e.type === "question" && e.data.id === "list.fullName");
  assert.ok(nameQ, events.filter((e) => e.type === "question").map((e) => e.data.id).join(","));
  assert.ok(nameQ.data.context.criterion, "expected a matched criterion on the fullName question");
  assert.match(nameQ.data.context.criterion.text, /name/i);
  // T23: the client needs q.form on every emitted question to tell a "confirm-or-pick" Ask apart from the rest.
  assert.ok(nameQ.data.form, "the emitted question carries its form id");
});
