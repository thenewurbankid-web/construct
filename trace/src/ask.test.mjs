// T12.5: buildQuestions() still asks about every real tie (never auto-resolves one — see name-evidence.mjs's
// file header for why), but orders and labels the name-matching option when one candidate's name evidence is
// a clear winner.
// T12.4: the "something else" placeholder builder asks ONE joint follow-up question, not three sequential ones.
import test from "node:test";
import assert from "node:assert/strict";
import { buildQuestions, resolveQuestions } from "./ask.mjs";

const realOpts = (q) => q.options.filter((o) => o.value?.field);

test("a tied row field lists the name-matching candidate first, labelled, but still asks (both options remain)", () => {
  const m = {
    list: {
      name: "table",
      fields: [{ name: "riskScore", examples: ["72"], candidates: [{ field: "budget", formatter: "asText", cost: 0 }, { field: "risk", formatter: "asText", cost: 0 }] }],
      sort: [{ field: null, dir: "none", label: "keep the API order" }],
      actions: [],
    },
    values: [], actions: [], endpoints: {}, block: null,
  };
  const q = buildQuestions(m).find((x) => x.id === "list.riskScore");
  assert.ok(q, "a tied field is still asked");
  const opts = realOpts(q);
  assert.equal(opts.length, 2, "both tied candidates are still offered");
  assert.equal(opts[0].value.field, "risk", "the name-matching candidate is listed first");
  assert.match(opts[0].label, /closest name match/);
  assert.doesNotMatch(opts[1].label, /closest name match/);
});

test("a tie with no name evidence keeps candidates in their original order, unlabelled", () => {
  const m = {
    list: {
      name: "table",
      fields: [{ name: "amount", examples: ["72"], candidates: [{ field: "colour", formatter: "asText", cost: 0 }, { field: "weight", formatter: "asText", cost: 0 }] }],
      sort: [{ field: null, dir: "none", label: "keep the API order" }],
      actions: [],
    },
    values: [], actions: [], endpoints: {}, block: null,
  };
  const q = buildQuestions(m).find((x) => x.id === "list.amount");
  const opts = realOpts(q);
  assert.deepEqual(opts.map((o) => o.value.field), ["colour", "weight"]);
  for (const o of opts) assert.doesNotMatch(o.label, /closest name match/);
});

test("a tied page value also gets name-evidence ordering", () => {
  const m = {
    list: null,
    values: [{ name: "riskTotal", example: "60", candidates: [{ agg: "field", field: "budgetTotal", formatter: "asText", cost: 1 }, { agg: "field", field: "riskTotal", formatter: "asText", cost: 1 }] }],
    actions: [], endpoints: {}, block: null,
  };
  const q = buildQuestions(m).find((x) => x.id === "value.riskTotal");
  const opts = realOpts(q);
  assert.equal(opts[0].value.field, "riskTotal");
  assert.match(opts[0].label, /closest name match/);
});

test("an equal-cost tie with no unique name winner (e.g. two coupled/identical-value candidates named alike) is still asked with both options intact", () => {
  // Mirrors eval's "coupled" category: k identical fields, shuffled identity, similarly named — no single name
  // should ever be favoured here, which is exactly what must NOT happen (see name-evidence.mjs's file header).
  const m = {
    list: {
      name: "table",
      fields: [{ name: "owner", examples: ["Ann"], candidates: [{ field: "ownerA", formatter: "asText", cost: 0 }, { field: "ownerB", formatter: "asText", cost: 0 }] }],
      sort: [{ field: null, dir: "none", label: "keep the API order" }],
      actions: [],
    },
    values: [], actions: [], endpoints: {}, block: null,
  };
  const q = buildQuestions(m).find((x) => x.id === "list.owner");
  const opts = realOpts(q);
  assert.equal(opts.length, 2);
  for (const o of opts) assert.doesNotMatch(o.label, /closest name match/); // "ownerA" and "ownerB" tie evenly
});

// ---------- T12.4: joint question ----------
const noMatchModel = () => ({
  list: {
    name: "table",
    fields: [{ name: "totalRisk", examples: ["$5"], candidates: [] }], // no match at all: "something else" is offered
    sort: [{ field: null, dir: "none", label: "keep the API order" }],
    actions: [],
  },
  values: [], actions: [], endpoints: { list: { response: [{ risk: 10, budget: 20 }] } }, block: null,
});

test("'something else' builds ONE joint follow-up (no `steps` chain), with fields pre-suggested by name evidence", () => {
  const q = buildQuestions(noMatchModel()).find((x) => x.id === "list.totalRisk");
  const somethingElse = q.options.find((o) => o.custom);
  assert.ok(somethingElse, "there is a 'something else' option");
  assert.equal(typeof somethingElse.custom.joint, "function", "T12.4: one joint step, not a `steps` chain");
  assert.equal(somethingElse.custom.steps, undefined);
  const jq = somethingElse.custom.joint();
  assert.equal(jq.type, "joint");
  assert.deepEqual(jq.suggestedInputs, ["risk"], `the field lexically closest to "totalRisk" is pre-suggested, "budget" is not`);
});

test("resolveQuestions: the interactive prompt answers the joint follow-up once and applies one combined placeholder", async () => {
  const m = noMatchModel();
  const questions = buildQuestions(m);
  const asked = [];
  const prompt = async (q) => {
    asked.push(q);
    if (q.type === "joint") return { from: "fields", inputs: ["risk", "budget"], fn: "myTotal" };
    return q.options.findIndex((o) => o.custom); // pick "something else" on the top-level question
  };
  await resolveQuestions(questions, { prompt });
  const f = m.list.fields[0];
  assert.equal(f.candidates.length, 1);
  assert.deepEqual(f.candidates[0], { custom: true, from: "fields", inputs: ["risk", "budget"], fn: "myTotal" });
  assert.equal(asked.filter((q) => q.type === "joint").length, 1, "exactly one joint question was asked, not three separate ones");
});

test("resolveQuestions: skipping the joint follow-up leaves the part open (a TODO), not half-answered", async () => {
  const m = noMatchModel();
  const questions = buildQuestions(m);
  const prompt = async (q) => (q.type === "joint" ? { skip: true } : q.options.findIndex((o) => o.custom));
  const { log } = await resolveQuestions(questions, { prompt });
  const f = m.list.fields[0];
  assert.deepEqual(f.candidates, [{ todo: true, skipped: true }]);
  assert.ok(log.some((l) => l.skipped));
});
