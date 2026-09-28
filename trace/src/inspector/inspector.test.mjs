// The Part inspector's server side: option order, proof, preview, apply / undo / redo, fix all similar, Suggest and the scoped chat.
// No hosted model and no live model anywhere: Suggest and the chat run against fake providers.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { computeState, readAnswers } from "./state.mjs";
import { buildForm, scopeOf, proofOf } from "./options.mjs";
import { inspectPart, resolveChoice, similarParts } from "./inspect.mjs";
import { previewChanges, SCRATCH_ROOT } from "./preview.mjs";
import { applyChanges, undo, redo, readHistory, summary, stable, HISTORY } from "./history.mjs";
import { createInspectorRoutes } from "./routes.mjs";
import { factsSheet, inScope, checkReply, parseReply, REFUSAL } from "./chat.mjs";
import { runPipeline } from "../pipeline.mjs";
import { resetExample } from "../reset.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
// A clean copy of an example (no answers, no history) inside a temporary examples folder.
function fixture(name, { mutate } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "trace-inspector-"));
  const dir = path.join(base, "examples", name);
  fs.cpSync(path.join(root, "examples", name), dir, { recursive: true });
  for (const f of ["answers.json", "decisions.json", "ai-cache.json", "answers.history.jsonl"]) fs.rmSync(path.join(dir, f), { force: true });
  mutate?.(dir);
  return { dir, examplesDir: path.join(base, "examples"), outRoot: path.join(base, "out"), base };
}
const hashDir = (dir) => crypto.createHash("sha1").update(fs.readdirSync(dir).sort().map((f) => f + ":" + (fs.statSync(path.join(dir, f)).isFile() ? fs.readFileSync(path.join(dir, f), "utf8") : "dir")).join("\n")).digest("hex");
const scratchDirs = () => fs.readdirSync(SCRATCH_ROOT).filter((f) => f.startsWith("trace-preview-")).sort();

// ---------- options ----------
test("options come in a fixed order: candidates by cost then label, then Gap, then Stubs, then fixed text; the first is the Rule default", async () => {
  const { dir } = fixture("invoices");
  const st = await computeState(dir);
  const form = buildForm(st, "list.requestedBy");
  assert.equal(form.form, "which-field");
  assert.deepEqual(form.options.map((o) => o.id), ["pick:0", "pick:1", "gap", "stub:fields", "stub:controller"]);
  const cands = form.options.filter((o) => o.group === "candidates");
  assert.deepEqual(cands.map((o) => o.label), ["The field assignee", "The field requester"], "same cost, so alphabetical");
  assert.deepEqual(form.options.map((o) => o.ruleDefault), [true, false, false, false, false]);
  const gap = buildForm(st, "list.status");
  assert.equal(gap.form, "leave-or-stub");
  assert.deepEqual(gap.options.map((o) => o.id), ["gap", "stub:fields", "stub:controller", "static"]);
  assert.equal(gap.options[0].ruleDefault, true, "with no candidates the default is to leave it as a Gap");
  const value = buildForm(st, "value.syncedAt");
  assert.deepEqual(value.options.map((o) => o.id), ["gap", "stub:fields", "stub:controller", "stub:api", "static"], "a value may also come from a new endpoint");
  assert.equal(buildForm(st, "list.sort").form, "which-sort");
  assert.equal(buildForm(st, "action.row.archive").form, "which-endpoint");
  assert.equal(buildForm(st, "form.vendor").form, "info");
  assert.equal(buildForm(st, "form.vendor").applicable, false);
});

test("the same inputs give the same options in the same order, whatever order the API lists its fields in", async () => {
  const a = fixture("invoices");
  const b = fixture("invoices", {
    mutate: (dir) => {
      // the API is the feature's openapi file now: reverse the key order of every example body in it (not the order of the paths)
      const f = path.join(dir, "openapi.json"), doc = JSON.parse(fs.readFileSync(f, "utf8"));
      const rev = (o) => (Array.isArray(o) ? o.map(rev) : o && typeof o === "object" ? Object.fromEntries(Object.entries(o).reverse().map(([k, v]) => [k, rev(v)])) : o);
      const walk = (o) => { if (Array.isArray(o)) o.forEach(walk); else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) { if (k === "example") o[k] = rev(v); else walk(v); } };
      walk(doc);
      fs.writeFileSync(f, JSON.stringify(doc, null, 2));
    },
  });
  const sa = await computeState(a.dir), sb = await computeState(b.dir), sa2 = await computeState(a.dir);
  for (const id of ["list.requestedBy", "value.largestInvoice", "list.sort"]) {
    const labels = (s) => buildForm(s, id).options.filter((o) => o.group !== "stub").map((o) => `${o.id}:${o.label}`);
    assert.deepEqual(labels(sa), labels(sa2), `${id} is stable`);
    assert.deepEqual(labels(sa), labels(sb), `${id} does not depend on field order`);
  }
  const strip = (f) => JSON.stringify(f.options.map(({ id, label, ruleDefault, current }) => ({ id, label, ruleDefault, current })));
  assert.equal(strip(buildForm(sa, "list.requestedBy")), strip(buildForm(sa2, "list.requestedBy")));
});

test("the proof runs the same code on the design's own examples", async () => {
  const { dir } = fixture("invoices");
  const st = await computeState(dir);
  const sc = scopeOf(st, "list.requestedBy");
  const form = buildForm(st, "list.requestedBy");
  const pr = proofOf(st, sc, form.options[0].value);
  assert.equal(pr.verdict, "reproduces");
  assert.equal(pr.matched, 4);
  assert.deepEqual(pr.rows.map((r) => r.produced), ["Lena", "Mia", "Prerna", "Arjun"]);
  assert.equal(proofOf(st, sc, { todo: true }).verdict, "nothing");
  const bad = proofOf(st, scopeOf(st, "list.status"), { custom: true, from: "fields", inputs: ["vendor"], fn: "x", body: "item.vendor.toUpperCase()" });
  assert.equal(bad.verdict, "differs");
});

// ---------- choices become answers, checked by rules ----------
test("a choice is only ever one of the rule-computed options; a Stub expression is run on the design's examples", async () => {
  const { dir } = fixture("invoices");
  const st = await computeState(dir);
  assert.equal(resolveChoice(st, "list.requestedBy", { option: "pick:1" }).value.field, "requester");
  assert.match(resolveChoice(st, "list.requestedBy", { option: "pick:9" }).error, /not one of this part's choices/);
  assert.match(resolveChoice(st, "form.vendor", { option: "x" }).error, /closed in the design or the contract/);
  assert.match(resolveChoice(st, "list.status", { option: "stub:fields", inputs: [] }).error, /at least one API field/);
  assert.match(resolveChoice(st, "list.status", { option: "stub:fields", inputs: ["nope"] }).error, /not in the API response/);
  // a verified expression is kept and marked as yours
  const ok = resolveChoice(st, "list.requestedBy", { option: "stub:fields", inputs: ["requester"], fn: "who", expression: "item.requester" });
  assert.equal(ok.value.body, "item.requester");
  assert.equal(ok.value.by, "you");
  assert.equal(ok.value.unverified, undefined);
  assert.equal(ok.check.verified, true);
  // an expression that does not reproduce is refused unless you keep it as unverified
  const off = resolveChoice(st, "list.requestedBy", { option: "stub:fields", inputs: ["requester"], fn: "who", expression: "item.requester.toUpperCase()" });
  assert.equal(off.unverified, true);
  assert.equal(off.rows.length, 4);
  const kept = resolveChoice(st, "list.requestedBy", { option: "stub:fields", inputs: ["requester"], fn: "who", expression: "item.requester.toUpperCase()", keepUnverified: true });
  assert.equal(kept.value.unverified, true);
  // code that is not a plain expression never gets in, even as unverified
  const evil = resolveChoice(st, "list.requestedBy", { option: "stub:fields", inputs: ["requester"], fn: "who", expression: "process.exit(1)", keepUnverified: true });
  assert.match(evil.error, /can't be used/);
  // a function name is made a valid identifier by the same helper the terminal questions use
  assert.equal(resolveChoice(st, "list.requestedBy", { option: "stub:controller", fn: "get the who!" }).value.fn, "getTheWho");
});

// ---------- preview ----------
test("preview shows the effect without writing to the example, and removes its scratch copy", async () => {
  const { dir } = fixture("invoices");
  const before = hashDir(dir), scratch = scratchDirs();
  const st = await computeState(dir);
  const value = resolveChoice(st, "list.requestedBy", { option: "pick:1" }).value;
  const pv = await previewChanges({ dir, changes: [{ id: "list.requestedBy", value }] });
  assert.equal(pv.before.fit, 13);
  assert.equal(pv.after.fit, 14);
  assert.equal(pv.line, "13 of 19 parts fit → 14 of 19");
  assert.deepEqual(pv.parts, [{ id: "list.requestedBy", before: "tie", after: "fit", requested: true }]);
  assert.ok(pv.files.some((f) => /invoices\.domain\.js$/.test(f.path) && f.hunks.length), "the code diff of the affected files comes from src/diff.mjs");
  assert.ok(pv.files.every((f) => !/REPORT|status\.json/.test(f.path)));
  assert.equal(hashDir(dir), before, "nothing in the example changed");
  assert.deepEqual(scratchDirs(), scratch, "the scratch copy is gone");
  assert.ok(!SCRATCH_ROOT.includes(`${path.sep}examples`), "and it never lives inside an examples folder");
  // deterministic: the same preview twice is the same result
  assert.deepEqual(await previewChanges({ dir, changes: [{ id: "list.requestedBy", value }] }), pv);
});

test("preview cleans up after itself when the run fails", async () => {
  const { dir } = fixture("invoices");
  const scratch = scratchDirs();
  fs.writeFileSync(path.join(dir, "page.jsx"), "this is not jsx <<<");
  await assert.rejects(previewChanges({ dir, changes: [] }));
  assert.deepEqual(scratchDirs(), scratch);
});

// ---------- apply, undo, redo ----------
test("apply writes answers.json and one history line per change; Undo and Redo work per part and for the whole example", async () => {
  const { dir } = fixture("invoices");
  const st = await computeState(dir);
  const v1 = resolveChoice(st, "list.requestedBy", { option: "pick:1" }).value;
  const v2 = { todo: true };
  const now = () => "2026-01-01T00:00:00.000Z";
  applyChanges(dir, [{ id: "list.requestedBy", value: v1 }], { now });
  applyChanges(dir, [{ id: "list.status", value: v2 }], { source: "inspector+suggest", model: "fake:model", fact: "The Status column comes from a status the backend does not provide yet.", now });
  assert.deepEqual(readAnswers(dir), { "list.requestedBy": v1, "list.status": v2 });
  const lines = fs.readFileSync(path.join(dir, HISTORY), "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  for (const l of lines) assert.equal(l, stable(JSON.parse(l)), "one entry per line, keys sorted");
  const [h1, h2] = lines.map((l) => JSON.parse(l));
  assert.deepEqual([h1.source, h1.from, h1.to], ["inspector", null, v1]);
  assert.deepEqual([h2.source, h2.model, h2.fact.slice(0, 10)], ["inspector+suggest", "fake:model", "The Status"]);
  assert.deepEqual(summary(dir).edited, ["list.requestedBy", "list.status"]);

  // per part
  assert.equal(undo(dir, "list.requestedBy").ids[0], "list.requestedBy");
  assert.deepEqual(readAnswers(dir), { "list.status": v2 });
  assert.equal(summary(dir, "list.requestedBy").part.canRedo, true);
  assert.equal(summary(dir, "list.requestedBy").part.edited, false);
  assert.match(undo(dir, "list.requestedBy").error, /nothing to undo/);
  redo(dir, "list.requestedBy");
  assert.deepEqual(readAnswers(dir), { "list.requestedBy": v1, "list.status": v2 });
  // globally: the newest change first
  assert.deepEqual(undo(dir).ids, ["list.requestedBy"], "the redo made requestedBy the newest change");
  assert.deepEqual(undo(dir).ids, ["list.status"]);
  assert.deepEqual(readAnswers(dir), {});
  assert.match(undo(dir).error, /nothing to undo/);
  assert.deepEqual(redo(dir).ids, ["list.status"], "Redo brings back the one undone last");
  // a new change on a part clears its Redo
  applyChanges(dir, [{ id: "list.requestedBy", value: v1 }], { now });
  assert.equal(summary(dir, "list.requestedBy").part.canRedo, false);
  assert.equal(readHistory(dir).at(-1).n, readHistory(dir).length, "entries are numbered in order");
});

test("Undo never overwrites an answer that was changed by hand since", async () => {
  const { dir } = fixture("invoices");
  applyChanges(dir, [{ id: "list.status", value: { todo: true } }]);
  const answers = readAnswers(dir);
  answers["list.status"] = { static: true };
  fs.writeFileSync(path.join(dir, "answers.json"), JSON.stringify(answers));
  const r = undo(dir, "list.status");
  assert.match(r.error, /changed outside the inspector/);
  assert.deepEqual(readAnswers(dir), { "list.status": { static: true } });
  assert.equal(readHistory(dir).length, 1, "and nothing is recorded for a refused undo");
});

test("a change made in the inspector is what a Replay produces, and Reset clears the history too", async () => {
  const { dir, outRoot } = fixture("invoices");
  const st = await computeState(dir);
  applyChanges(dir, [{ id: "list.requestedBy", value: resolveChoice(st, "list.requestedBy", { option: "pick:1" }).value }]);
  const r = await runPipeline({ dir, outRoot, useSaved: true, auto: true });
  const after = await computeState(dir);
  assert.equal(after.stats.fit, 14);
  assert.match(fs.readFileSync(path.join(outRoot, "features", "invoices", "domain", "invoices.domain.js"), "utf8"), /requestedBy: asText\(item\.requester\)/);
  assert.ok(r.open.every((o) => o.id !== "list.requestedBy"));
  const insp = await inspectPart({ dir, outRoot, id: "list.requestedBy" });
  assert.equal(insp.term, "fit");
  assert.equal(insp.currentId, "pick:1");
  assert.equal(insp.history.edited, true);
  assert.ok(insp.code.generated);
  const slice = insp.code.slices.find((s) => s.layer === "Domain");
  assert.match(slice.file, /^features\/invoices\/domain\/invoices\.domain\.js$/);
  assert.ok(slice.start > 0 && slice.end >= slice.start);
  assert.match(slice.code, /toInvoiceRows/);
  assert.ok(slice.focus.length, "the line for this part is marked");
  resetExample(dir);
  assert.ok(!fs.existsSync(path.join(dir, HISTORY)));
});

test("before any run it says plainly that nothing is generated", async () => {
  const { dir, outRoot } = fixture("invoices");
  const insp = await inspectPart({ dir, outRoot, id: "value.syncedAt" });
  assert.equal(insp.code.generated, false);
  assert.deepEqual(insp.code.slices, []);
});

// ---------- fix all similar ----------
test("fix all similar groups parts with the same kind of problem and the same candidates", async () => {
  const { dir } = fixture("portfolio-redesigned");
  const st = await computeState(dir);
  const sim = similarParts(st, "list.spend", { option: "gap" });
  assert.ok(sim.length >= 5);
  assert.ok(sim.every((x) => x.id.startsWith("list.") && x.id !== "list.spend" && x.id !== "list.sort"), "row fields only: a value has other choices");
  assert.ok(sim.every((x) => x.option === "gap"));
  assert.deepEqual(sim, similarParts(st, "list.spend", { option: "gap" }), "in a fixed order");
  assert.deepEqual(similarParts(st, "list.spend", { option: "static" }), [], "fixed text is never offered in bulk");
  assert.deepEqual(similarParts(st, "list.spend", { option: "stub:fields", inputs: ["spend.value"] }), [], "nor is a Stub, which is specific to its part");
  const inv = await computeState(fixture("invoices").dir);
  assert.deepEqual(similarParts(inv, "list.requestedBy", { option: "pick:1" }), [], "a Tie with different candidates is not similar");
  // applying to several parts is one group: one Undo takes them all back
  const { dir: d2 } = fixture("portfolio-redesigned");
  applyChanges(d2, [{ id: "list.spend", value: { todo: true } }, ...sim.map((x) => ({ id: x.id, value: { todo: true } }))]);
  const h = readHistory(d2);
  assert.equal(new Set(h.map((e) => e.group)).size, 1);
  assert.equal(undo(d2).ids.length, sim.length + 1);
  assert.deepEqual(readAnswers(d2), {});
  const pv = await previewChanges({ dir, changes: [{ id: "list.spend", value: { todo: true } }, ...sim.map((x) => ({ id: x.id, value: { todo: true } }))] });
  assert.equal(pv.before.fit, pv.after.fit, "answering Gaps as Gaps does not change what fits");
  assert.equal(pv.parts.length, sim.length + 1);
});

// ---------- the routes: Suggest with a fake provider, the scoped chat ----------
function serve(fx, options = {}) {
  const route = createInspectorRoutes({ examplesDir: fx.examplesDir, outRoot: fx.outRoot, ...options });
  const readBody = (req) => new Promise((resolve) => { let s = ""; req.on("data", (c) => (s += c)); req.on("end", () => resolve(s ? JSON.parse(s) : {})); });
  const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  const file = (res, p, type) => { res.writeHead(200, { "content-type": type }); res.end(fs.readFileSync(p)); };
  const server = http.createServer(async (req, res) => { if (!(await route(req, res, new URL(req.url, "http://x"), { readBody, json, file }))) res.writeHead(404).end(); });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` })));
}
const postJson = async (url, body) => { const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); return { status: r.status, j: await r.json() }; };
const number = (prompt, re, from) => Number((prompt.split("\n").find((l) => re.test(l) && (!from || l.startsWith(from))) ?? "0)").split(/[).]/)[0]);
// what a provider returns: text and usage (see ai/provider.mjs)
const asProvider = (fn) => async (req) => ({ text: await fn(req), usage: { in: 1, out: 1 } });
// the fake "model": picks the option that mentions `pick` and cites the fact that mentions `cite`
const fakeAi = (pick, cite) => asProvider(async ({ user }) => {
  const opts = user.split("Options:\n")[1].split("Facts:")[0], facts = user.split("Facts:\n")[1];
  return JSON.stringify({ choice: number(opts, new RegExp(pick, "i")), fact: number(facts, new RegExp(cite, "i")) });
});

test("Suggest picks one of the rule-computed options with its cited fact, writes nothing, and applying stays a click", async () => {
  const fx = fixture("invoices");
  const before = hashDir(fx.dir);
  const { server, url } = await serve(fx, { aiProvider: fakeAi("requester", "requested") });
  try {
    const r = await postJson(`${url}/api/suggest`, { example: "invoices", id: "list.requestedBy" });
    assert.equal(r.status, 200);
    assert.equal(r.j.ok, true);
    assert.equal(r.j.option, "pick:1");
    assert.equal(r.j.label, "The field requester");
    assert.match(r.j.fact, /who requested it/);
    assert.ok(r.j.model);
    assert.equal(hashDir(fx.dir), before, "Suggest wrote nothing: no answer, no cache, no decisions");
    // the click that applies it records where it came from
    const ap = await postJson(`${url}/api/part-apply`, { example: "invoices", changes: [{ id: "list.requestedBy", choice: r.j.choice }], suggest: { model: r.j.model, fact: r.j.fact } });
    assert.equal(ap.status, 200);
    const h = readHistory(fx.dir)[0];
    assert.equal(h.source, "inspector+suggest");
    assert.equal(h.model, r.j.model);
    assert.match(h.fact, /who requested it/);
    assert.equal(readAnswers(fx.dir)["list.requestedBy"].field, "requester");
  } finally { server.close(); }
});

test("Suggest abstains with a plain reason, and says so in one line when its helper cannot be reached", async () => {
  const fx = fixture("invoices");
  const none = await serve(fx, { aiProvider: asProvider(async () => JSON.stringify({ choice: 1, fact: 0 })) });
  try {
    const r = await postJson(`${none.url}/api/suggest`, { example: "invoices", id: "list.requestedBy" });
    assert.equal(r.j.ok, false);
    assert.equal(r.j.abstain, true);
    assert.match(r.j.reason, /could not point to a fact/);
    const closed = await postJson(`${none.url}/api/suggest`, { example: "invoices", id: "form.vendor" });
    assert.match(closed.j.reason, /closed in the design or the contract/);
  } finally { none.server.close(); }
  const down = await serve(fx, { aiProvider: async () => { throw new Error("fetch failed"); } });
  try {
    const r = await postJson(`${down.url}/api/suggest`, { example: "invoices", id: "list.requestedBy" });
    assert.equal(r.j.unreachable, true);
    assert.match(r.j.reason, /can't reach its helper/);
    // everything else keeps working
    const part = await (await fetch(`${down.url}/api/part?example=invoices&id=list.requestedBy`)).json();
    assert.equal(part.id, "list.requestedBy");
  } finally { down.server.close(); }
});

test("Suggest may draft a Stub expression, which the evaluator checks against the design's examples", async () => {
  const fx = fixture("invoices");
  const calls = [];
  // T12.4: "where does it come from?" and "which fields feed it?" are now one joint question (ask.mjs's
  // askJoint/ai/index.mjs's answerJoint), so the mock answers them together in one reply instead of two.
  const provider = asProvider(async (req) => {
    calls.push(req.user);
    if (/Write ONE JavaScript expression/.test(req.user)) return JSON.stringify({ expression: "item.requester" });
    if (/Where from:/.test(req.user)) {
      return JSON.stringify({
        from: number(req.user, /combine values/i),
        inputs: [number(req.user, /"requester"/)],
        fact: number(req.user.split("Facts:\n")[1] ?? "", /requested/i),
      });
    }
    return JSON.stringify({ choice: number(req.user.split("Options:\n")[1]?.split("Facts:")[0] ?? "", /something else/i), fact: number(req.user.split("Facts:\n")[1] ?? "", /requested/i) });
  });
  const { server, url } = await serve(fx, { aiProvider: provider });
  try {
    const r = await postJson(`${url}/api/suggest`, { example: "invoices", id: "list.requestedBy" });
    assert.equal(r.j.ok, true, JSON.stringify(r.j));
    assert.equal(r.j.option, "stub:fields");
    assert.deepEqual(r.j.choice.inputs, ["requester"]);
    assert.equal(r.j.expression.code, "item.requester");
    assert.equal(r.j.expression.verified, true);
  } finally { server.close(); }
});

test("the routes refuse unknown examples and parts, and only ever write answers.json and answers.history.jsonl", async () => {
  const fx = fixture("invoices");
  const { server, url } = await serve(fx);
  try {
    assert.equal((await fetch(`${url}/api/part?example=nope&id=value.x`)).status, 404);
    assert.equal((await fetch(`${url}/api/part?example=invoices&id=value.nope`)).status, 404);
    assert.equal((await fetch(`${url}/api/part?example=..&id=value.x`)).status, 404);
    const bad = await postJson(`${url}/api/part-apply`, { example: "invoices", changes: [{ id: "list.status", choice: { option: "pick:7" } }] });
    assert.equal(bad.status, 422);
    assert.deepEqual(readAnswers(fx.dir), {});
    const parts = await (await fetch(`${url}/api/parts?example=invoices`)).json();
    assert.equal(parts.parts.length, 19);
    assert.equal(parts.stats.fit, 13);
    const before = fs.readdirSync(fx.dir).sort();
    const pv = await postJson(`${url}/api/part-preview`, { example: "invoices", changes: [{ id: "list.status", choice: { option: "gap" } }] });
    assert.equal(pv.status, 200);
    await postJson(`${url}/api/part-apply`, { example: "invoices", changes: [{ id: "list.status", choice: { option: "gap" } }] });
    assert.deepEqual(fs.readdirSync(fx.dir).sort(), [...before, "answers.history.jsonl", "answers.json"].sort());
    const un = await postJson(`${url}/api/part-undo`, { example: "invoices" });
    assert.equal(un.status, 200);
    assert.equal((await postJson(`${url}/api/part-undo`, { example: "invoices" })).status, 422);
    const sim = await postJson(`${url}/api/part-similar`, { example: "invoices", id: "list.status", choice: { option: "gap" } });
    assert.ok(Array.isArray(sim.j.similar));
  } finally { server.close(); }
});

// ---------- the scoped chat ----------
test("the chat refuses questions that are not about the part, before any model is asked", async () => {
  const fx = fixture("invoices");
  let asked = 0;
  const { server, url } = await serve(fx, { chatConfig: { provider: "fake", model: "fake", fn: async () => { asked++; return "never"; } } });
  try {
    for (const q of ["What is the weather in Paris?", "Write me a poem about the sea", "How do I center a div?"]) {
      const r = await fetch(`${url}/api/part-chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ example: "invoices", id: "list.requestedBy", question: q }) });
      const text = await r.text();
      const done = JSON.parse(text.split("\n\n").filter(Boolean).map((l) => l.slice(5)).at(-1));
      assert.equal(done.type, "done");
      assert.equal(done.refused, true, q);
      assert.equal(done.text, REFUSAL);
    }
    assert.equal(asked, 0, "the model was never called");
  } finally { server.close(); }
});

test("the chat streams a reply and checks it against this part's facts: invented names and numbers are flagged, a proposal is only a number", async () => {
  const fx = fixture("invoices");
  const replies = ["The assignee field is a fine choice because assignee_id 4711 matches. Try the requester.\nPROPOSE: 2", "Both fields give Lena, Mia, Prerna and Arjun, so the data cannot tell them apart. Option 1 is the rule's default.\nPROPOSE: 9"];
  let n = 0;
  const { server, url } = await serve(fx, { chatConfig: { provider: "fake", model: "fake", fn: async () => replies[n++] } });
  const ask = async (question) => {
    const r = await fetch(`${url}/api/part-chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ example: "invoices", id: "list.requestedBy", question }) });
    const events = (await r.text()).split("\n\n").filter(Boolean).map((l) => JSON.parse(l.slice(5)));
    return events;
  };
  try {
    const e1 = await ask("Which option would you pick for this part?");
    assert.deepEqual(e1.map((e) => e.type).filter((t, i, a) => a.indexOf(t) === i), ["start", "text", "done"]);
    const d1 = e1.at(-1);
    assert.equal(d1.refused, false);
    assert.equal(d1.proposed, 2);
    assert.equal(d1.check.ok, false);
    assert.ok(d1.check.flagged.includes("assignee_id") && d1.check.flagged.includes("4711"), JSON.stringify(d1.check.flagged));
    assert.doesNotMatch(d1.text, /PROPOSE/);
    const d2 = (await ask("Why can't it tell them apart? Both are in this part.")).at(-1);
    assert.equal(d2.check.ok, true, JSON.stringify(d2.check));
    assert.equal(d2.proposed, null, "an option number outside the list is not a proposal");
  } finally { server.close(); }
});

test("pure chat helpers: scope words, the fact check, and the proposal line", async () => {
  const fx = fixture("invoices");
  const insp = await inspectPart({ dir: fx.dir, outRoot: fx.outRoot, id: "list.requestedBy" });
  const sheet = factsSheet(insp);
  assert.match(sheet, /^PART: Requested by \(list\.requestedBy\)/);
  assert.match(sheet, /1\) The field assignee \[Rule default\]/);
  assert.match(sheet, /GENERATED CODE: not generated yet\./);
  assert.ok(inScope("Why is this open?", insp));
  assert.ok(inScope("what is assignee?", insp));
  assert.ok(!inScope("What is the capital of France?", insp));
  assert.ok(!inScope("", insp));
  assert.equal(checkReply({ sheet, question: "q", reply: "Lena and Mia come from the field requester." }).ok, true);
  assert.deepEqual(checkReply({ sheet, question: "q", reply: 'Use "shadow_field" or 99%.' }).flagged.sort(), ['"shadow_field"', "99%"].sort());
  assert.equal(checkReply({ sheet, question: "q", reply: "Pick option 2.", optionCount: 5 }).ok, true);
  assert.deepEqual(parseReply("Because.\nPROPOSE: 3", 5), { text: "Because.", proposed: 3, proposedRaw: 3 });
  assert.equal(parseReply("PROPOSE: 8", 5).proposed, null);
});
