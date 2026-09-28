// The AI layer with a fake model: what it accepts, what it refuses, and that a re-run costs nothing.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createAi, evalExpression } from "./index.mjs";
import { words, retrieve } from "./context.mjs";

const dir = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "lm-ai-"));
  fs.writeFileSync(path.join(d, "story.md"), "- Owner is the project lead.\n- Initials are the first letter of the first name and of the last name.\n");
  return d;
};
const spec = { docs: {} };
const q = () => ({ id: "list.owner", type: "choice", text: 'Row part "owner" (e.g. "Lena") matches more than one API field.', options: [{ label: 'API field "lead"', value: 1 }, { label: 'API field "deputy"', value: 2 }] });
const make = (d, fn, matched = {}) => createAi({ dir: d, spec, source: "export default function P(){ return <main/>; }", matched, provider: async (req) => ({ text: await fn(req), usage: { in: 100, out: 10 } }) });

test("expressions: simple ones run, anything else is refused", () => {
  assert.equal(evalExpression("[item.a, item.b].join(' ')", { item: { a: "x", b: "y" } }), "x y");
  for (const bad of ["process.exit(1)", "item.constructor", "() => 1", "a; b", "require('fs')"]) assert.throws(() => evalExpression(bad, { item: {} }));
});

test("retrieval: word overlap, camelCase aware", () => {
  assert.deepEqual(words("requestedBy"), ["requested"]);
  assert.deepEqual(retrieve(["Owner is the lead.", "Nothing here."], words("owner")), ["Owner is the lead."]);
});

test("answers only with a cited fact about the part or the chosen option", async () => {
  const ok = make(dir(), () => '{"choice":1,"fact":1}');
  assert.equal((await ok.answer(q())).value, 1);
  assert.match(ok.decisions["list.owner"].evidence, /project lead/);

  const noCite = make(dir(), () => '{"choice":1,"fact":0}');
  assert.equal(await noCite.answer(q()), null);
  const badNumber = make(dir(), () => '{"choice":9,"fact":1}');
  assert.equal(await badNumber.answer(q()), null);
  const junk = make(dir(), () => "sure!");
  assert.equal(await junk.answer(q()), null);
});

test("a second run replays from the cache: zero calls", async () => {
  const d = dir();
  const a = make(d, () => '{"choice":2,"fact":1}');
  await a.answer(q()); a.save();
  const b = make(d, () => { throw new Error("must not be called"); });
  assert.equal((await b.answer(q())).value, 2);
  assert.equal(b.stats.calls, 0);
  assert.equal(b.stats.cached, 1);
});

test("an unreachable model is skipped, not fatal", async () => {
  const a = make(dir(), () => { throw new Error("connection refused"); });
  assert.equal(await a.answer(q()), null);
  assert.match(a.stats.errors[0], /connection refused/);
});

test("draft-body: kept only if it reproduces the design's examples", async () => {
  const cand = () => ({ custom: true, from: "fields", inputs: ["first", "last"], fn: "fullName" });
  const matched = (c) => ({
    endpoints: { list: { response: [{ first: "Lena", last: "Kumar" }, { first: "Arjun", last: "Rao" }] } },
    list: { alignedIdx: [0, 1], fields: [{ name: "fullName", examples: ["Lena Kumar", "Arjun Rao"], candidates: [c] }] },
    values: [],
  });
  const good = cand();
  const ai = make(dir(), () => '{"expression":"[item.first, item.last].join(\' \')"}', matched(good));
  await ai.draft();
  assert.equal(good.body, "[item.first, item.last].join(' ')");

  const wrong = cand();
  const ai2 = make(dir(), () => '{"expression":"item.first"}', matched(wrong));
  await ai2.draft();
  assert.equal(wrong.body, undefined); // wrong twice -> stays a plain placeholder

  const evil = cand();
  const ai3 = make(dir(), () => '{"expression":"process.exit(1)"}', matched(evil));
  await ai3.draft();
  assert.equal(evil.body, undefined);
});

// ---- explanations and summary blocks: only what the facts contain gets through ----
import { checkExplanation, checkBlock, plainTemplate } from "./explain.mjs";
import { summaryBlocks } from "../summary-blocks.mjs";

test("explanations: grounded text passes, invented numbers or quotes fall back", () => {
  const o = { part: "row.owner", state: "tie", why: '"lead" and "deputy" both reproduce "Lena"', hint: 'change "deputy" in one row' };
  const facts = `part: ${o.part}\nstate: tie\nwhat we know: ${o.why}\nwhat would close it: ${o.hint}`;
  const good = { headline: 'The Owner column could be "lead" or "deputy"', why: "The sample data can't tell them apart.", action: 'Change "deputy" in one row.' };
  assert.equal(checkExplanation(good, facts, o).ok, true);
  assert.equal(checkExplanation({ ...good, why: "This affects 40% of users." }, facts, o).ok, false); // invented number
  assert.equal(checkExplanation({ ...good, action: 'Rename it to "assignee".' }, facts, o).ok, false); // invented name
  assert.equal(checkExplanation({ ...good, headline: "Something unrelated about billing" }, facts, o).ok, false);
  assert.equal(checkExplanation({ ...good, why: "x".repeat(300) }, facts, o).ok, false);
  assert.match(plainTemplate(o).headline, /row\.owner/);
});

test("summary blocks: each carries only its own facts, the model text must stay inside them", () => {
  const blocks = summaryBlocks({
    stats: { total: 14, missing: 1, ask: 2, placeholder: 0 },
    log: [{ question: 'Row part "owner" ...', answer: "x", skipped: true }, { question: "q2", answer: "y", skipped: false, source: "you" }],
    open: [{ id: "list.owner", part: "row.owner", state: "tie", why: "w", hint: "h" }],
    changes: [{ path: "domain/x.js", status: "modified", added: 5, removed: 2 }, { path: "REPORT.md", status: "unchanged", added: 0, removed: 0 }],
    ai: null,
  });
  const conn = blocks.find((b) => b.key === "connections");
  assert.match(conn.facts, /complete: 11/);
  assert.doesNotMatch(conn.facts, /files changed/); // scoped: the connections block never sees the code numbers
  assert.equal(conn.attention, "bad");
  assert.equal(checkBlock({ summary: "11 of 14 are complete; 1 has nothing behind it." }, conn).ok, true);
  assert.equal(checkBlock({ summary: "Only 90% are complete." }, conn).ok, false);
  assert.match(blocks.find((b) => b.key === "code").template, /1 file changed/);
});

test("claims about counts must match the facts", async () => {
  const { checkClaims } = await import("./explain.mjs");
  const facts = "open items: 6\nblockers (missing API or contract gap): 0\nties that could be answered wrongly: 0\nskipped decisions: 6\nplaceholders to write: 0";
  assert.match(checkClaims("All open items are placeholders.", facts), /placeholders/); // says placeholders, facts say none
  assert.equal(checkClaims("Six decisions were skipped and there are no blockers.", facts), null);
  assert.match(checkClaims("There are no skipped decisions.", facts), /skipp/); // contradicts a non-zero count
  assert.match(checkClaims("Several ties remain.", facts), /ties/);
  assert.match(checkClaims("The import failed.", facts), /failed/); // not in the facts at all
});

test("team routing: a rule, and skipped items are routed by why they were open", async () => {
  const { teamFor, buildActions, composeEmail } = await import("../actions.mjs");
  assert.equal(teamFor({ id: "list.status", state: "missing", why: "No API field", hint: "" }), "backend");
  assert.equal(teamFor({ id: "list.owner", state: "tie", why: "", hint: "" }), "product");
  assert.equal(teamFor({ id: "action.row.archive", state: "missing", why: "isn't a verb", hint: "" }), "product");
  assert.equal(teamFor({ id: "action.row.delete", state: "missing", why: "the API for it (remove) wasn't given", hint: "Add a DELETE endpoint" }), "backend");
  assert.equal(teamFor({ id: "form.missing.owner", state: "gap", why: "", hint: "" }), "design");
  assert.equal(teamFor({ id: "form.notes", state: "gap", why: "", hint: "" }), "backend");
  assert.equal(teamFor({ id: "value.x", state: "skipped", origin: "missing", why: "", hint: "" }), "backend");
  assert.equal(teamFor({ id: "value.y", state: "skipped", origin: "tie", why: "", hint: "" }), "product");
  assert.equal(teamFor({ id: "list.z", state: "placeholder", why: "fn() is a placeholder in the controller layer.", hint: "" }), "frontend");
  assert.equal(teamFor({ id: "value.n", state: "placeholder", why: "fn() is a placeholder in the service layer.", hint: "" }), "backend");
  const teams = buildActions({ open: [{ id: "list.status", part: "row.status", state: "skipped", origin: "missing", why: "No API field produces the values.", hint: "Add a status field." }], visuals: [{ tag: "svg", where: 'the "Trend" column' }], matched: { endpoints: {}, list: null, values: [], forms: [], gaps: [] }, spec: { feature: "x", apis: [] } });
  const backend = teams.find((t) => t.key === "backend");
  assert.equal(backend.items.length, 2); // the missing field, and the chart's data
  assert.match(backend.items[0].title, /nothing behind it in the API/); // worded by origin, not "skipped"
  assert.equal(teams.find((t) => t.key === "design").items.length, 1); // the chart component
  const mail = composeEmail(backend, "x", { apis: [{ method: "GET", path: "/api/x" }] });
  assert.match(mail.subject, /Backend \/ API: 2 action items/);
  assert.match(mail.body, /1\. .*\n {3}What we saw: No API field produces the values\./);
  assert.match(mail.body, /GET \/api\/x/);
});
