// The beam planner on real trace/examples (orders: no fork; deals and invoices: forks, a question, goals).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { planBeamDir, answerBeam } from "./index.mjs";
import { assertBeamEvent, BEAM_CAP } from "./contract.mjs";
import { forkPoints, trimTo, refPoints, layerRef } from "./fork.mjs";
import { readSpec } from "../contract.mjs";

const EX = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../examples");
const dir = (name) => path.join(EX, name);
const listing = (d) => fs.readdirSync(d).sort().map((f) => `${f}:${fs.statSync(path.join(d, f)).mtimeMs}`);

test("orders: no multi-candidate point, one run, its plan steps; nothing written to the example", () => {
  const before = listing(dir("orders"));
  const r = planBeamDir(dir("orders"));
  assert.equal(r.outcome, "plan");
  assert.equal(r.plan.run, "r0");
  assert.ok(r.plan.steps.some((s) => s.args.layer === "Page") && r.plan.steps.every((s) => s.tool === "trace.emit"));
  assert.deepEqual(listing(dir("orders")), before);
  assert.deepEqual(r.events.map((e) => e.t), ["runOpened", "runRanked", "done"]);
});

test("deals: forks list.owner x list.csm, emits the top 3, asks ONE closed question, recommended first", () => {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "construct-beam-")), "events.jsonl");
  const r = planBeamDir(dir("deals"), { events: out });
  const lines = fs.readFileSync(out, "utf8").trim().split("\n").map((l) => JSON.parse(l));
  for (const e of lines) assertBeamEvent(e);
  assert.deepEqual(lines, r.events);
  assert.equal(lines.at(-1).t, "done");
  assert.equal(r.outcome, "question");
  const q = r.question;
  assert.equal(q.options[0].id, q.recommended);
  assert.match(q.options[0].sentence, /list\.owner: API field "owner"; list\.csm: API field "csm"/); // no repeated field wins
  assert.ok(q.options.length >= 2 && q.options.length <= 4);
  const steps = answerBeam(r, { answer: q.id, option: q.options[1].id });
  assert.equal(steps[0].args.forks["list.csm"], r.runs[q.options[1].id].forks.find((f) => f.point === "list.csm").pick);
  assert.throws(() => answerBeam(r, { answer: q.id, option: "r999" }), /not an option/);
  // Every closed run has a reason; the fourth run was closed by the emit cap.
  assert.ok(Object.values(r.runs).some((x) => x.closed?.reason === "cap"));
});

test("deals: a goal condition (Line expression) narrows the runs to one -> plan steps", () => {
  const goals = [{ id: "csm-shows-csm", expr: { and: [{ eq: [{ path: ["plan", "fields", "csm", "field"] }, "csm"] }, { eq: [{ path: ["plan", "fields", "owner", "field"] }, "owner"] }] } }];
  const r = planBeamDir(dir("deals"), { goals, emitTop: 4 });
  assert.equal(r.outcome, "plan");
  assert.equal(r.plan.steps[0].args.forks["list.csm"], "(csm)|asText");
  const goalClosed = Object.values(r.runs).filter((x) => x.closed?.reason === "goal");
  assert.ok(goalClosed.length >= 1 && goalClosed.every((x) => /Goal csm-shows-csm/.test(x.closed.detail)));
});

test("invoices: 12 combinations stay within the beam cap of 8; the structural gate re-checks forked parts", () => {
  const r = planBeamDir(dir("invoices"));
  const opened = r.events.filter((e) => e.t === "runOpened");
  assert.ok(opened.length > 1);
  assert.equal(r.outcome, "question");
  // After the last fork no more than BEAM_CAP leaf runs carry on.
  const leaves = Object.values(r.runs).filter((x) => x.forks.length === 3);
  assert.ok(leaves.filter((x) => x.closed?.reason !== "cap").length <= BEAM_CAP);
});

test("Line preconditions: the page node maps to line.setFragment; a changed page closes every run", () => {
  const spec = readSpec(dir("orders"));
  const pageSource = fs.readFileSync(path.join(dir("orders"), spec.page), "utf8");
  const pageFile = `features/orders/${spec.page}`;
  const hash = crypto.createHash("sha256").update(pageSource).digest("hex");
  const ok = planBeamDir(dir("orders"), { line: { facts: { files: { [pageFile]: { hash } } }, pageFile, pageSource } });
  assert.equal(ok.outcome, "plan");
  const stale = planBeamDir(dir("orders"), { line: { facts: { files: { [pageFile]: { hash: "0".repeat(64) } } }, pageFile, pageSource } });
  assert.equal(stale.outcome, "none");
  assert.equal(stale.runs.r0.closed.reason, "precondition");
  assert.match(stale.runs.r0.closed.detail, /line\.setFragment/);
});

test("scratch emit: a failing type check closes the run with reason emit", () => {
  const r = planBeamDir(dir("orders"), { typecheck: () => ({ ok: false, errors: ["x.js:1: ';' expected."] }) });
  assert.equal(r.outcome, "none");
  assert.equal(r.runs.r0.closed.reason, "emit");
});

test("readings and domain-map references fork the reading, not the page", () => {
  const readings = [{ intent: "wire.page", object: "page", target: null, layers: ["ui"], confidence: 0.9 }, { intent: "update.page", object: "page", target: null, layers: ["ui"], confidence: 0.5 }];
  const normalized = { ambiguous: { F1: ["feature:orders", "feature:order-history"], C1: ["item:x"] } };
  assert.deepEqual(refPoints(normalized).map((p) => p.point), ["ref:F1"]);
  const r = planBeamDir(dir("orders"), { readings, normalized });
  assert.equal(r.outcome, "question");
  assert.equal(r.runs[r.question.recommended].reading.intent, "wire.page");
  assert.match(r.question.sentence, /reading, ref:F1/);
});

test("fork points and trims are pure; layerRef is stub-first", () => {
  const m = { list: { fields: [{ name: "a", candidates: [{ field: "x", formatter: "asText", cost: 0 }, { field: "y", formatter: "asText", cost: 1 }] }], sort: [{ field: null, dir: "none" }] }, values: [], forms: [] };
  const [p] = forkPoints(m);
  assert.equal(p.point, "list.a");
  const t = trimTo(m, "list.a", p.candidates[1].pick);
  assert.equal(t.list.fields[0].candidates[0].field, "y");
  assert.equal(m.list.fields[0].candidates.length, 2);
  assert.deepEqual(layerRef("total", { "a.js": "export function total(items) {\n  // TODO\n}" }), { ref: "stub", file: "a.js" });
  assert.deepEqual(layerRef("total", { "a.js": "export function total(items) {\n  return 1;\n}" }), { ref: "fn", file: "a.js" });
  assert.deepEqual(layerRef("total", {}), { ref: "create", file: null });
});
