import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCorpus, loadCorpus, loadConfig } from "./run.mjs";
import { buildReport, stripTiming, renderMd, renderHtml, makeComparison } from "./report.mjs";
import { failuresOf, triage, FORMS } from "./triage.mjs";
import { promote } from "./promote.mjs";
import { exportLabels } from "./export-labels.mjs";
import { getVariant } from "./variants.mjs";
import { compareToBaseline, baselineFromReport } from "./gate.mjs";
import { ROOT, here, readJson } from "./util.mjs";

const loaded = loadCorpus();
const config = loadConfig();
let base;
const getBase = async () => (base ??= await runCorpus({ variant: "baseline", determinism: false, loaded }));

test("every part of every case has ground truth, and no truth is orphaned", async () => {
  const { records } = await getBase();
  for (const r of records) {
    assert.equal(r.counts.unlabelled, 0, `${r.id}: unlabelled parts`);
    assert.deepEqual(r.orphans, [], `${r.id}: truth for parts that do not exist`);
  }
  assert.equal(records.filter((r) => r.category === "example").length, 11);
  assert.ok(records.length >= 60);
});

test("the corpus is small: the whole baseline evaluation (no determinism) runs in a few seconds", async () => {
  const t = performance.now();
  await runCorpus({ variant: "baseline", determinism: false, loaded });
  assert.ok(performance.now() - t < 20000);
});

test("triage gives every failure a question form, and forms come from the defined set", async () => {
  const { records } = await getBase();
  const t = triage(records);
  assert.ok(t.failure_count > 0);
  for (const f of t.failures) {
    assert.ok(FORMS[f.form], `${f.case} ${f.part}: form ${f.form}`);
    assert.ok(f.question.options.length >= 2 || f.form === "plan", `${f.part} has options`);
    assert.ok(f.why.length > 10);
  }
  assert.ok(failuresOf(records.find((r) => r.category === "coincidence-spurious")).some((f) => f.type === "wrong-accept"));
});

test("a report is a pure function of the records: same hash, sorted keys, timing excluded", async () => {
  const { records, corpus, variant } = await getBase();
  const a = buildReport({ variant, records, corpus, config });
  const slow = JSON.parse(JSON.stringify(records));
  slow.forEach((r) => { r.timing.analyze_ms += 1000; });
  const b = buildReport({ variant, records: slow, corpus, config });
  assert.equal(a.report_hash, b.report_hash);
  assert.deepEqual(stripTiming(a), stripTiming(b));
  assert.deepEqual(Object.keys(a), [...Object.keys(a)].sort());
  assert.match(renderMd(a), /wrong-accept rate/);
  const html = renderHtml(a);
  assert.match(html, /<svg/);
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(html.replace(/<title>[^<]*<\/title>/, "")), "no external assets");
});

test("the negative-control variant is measurably worse and the gate fails it", async () => {
  const b = await getBase();
  const v = await runCorpus({ variant: "tie-first", determinism: false, loaded });
  const cmp = makeComparison(b.records, v.records, { bootstrap: { seed: 1, iters: 200 } });
  assert.equal(cmp.all.wrong_accept_rate.verdict, "real regression");
  assert.equal(cmp.all.questions_per_screen.verdict, "real improvement", "fewer questions is not a win when the answers are wrong");
  const bl = baselineFromReport(buildReport({ variant: getVariant("baseline"), records: b.records, corpus: b.corpus, config }));
  const rep = buildReport({ variant: getVariant("tie-first"), records: v.records, corpus: v.corpus, config });
  const g = compareToBaseline(bl, rep, config);
  assert.equal(g.ok, false);
  assert.match(g.failures.join("\n"), /wrong_accept_rate/);
  assert.equal(compareToBaseline(bl, buildReport({ variant: getVariant("baseline"), records: b.records, corpus: b.corpus, config }), config).ok, true);
});

test("promote turns a Ledger into a case with reviewable truth; AI answers are not trusted", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-promote-"));
  const src = path.join(ROOT, "examples", "invoices");
  for (const f of ["feature.json", "openapi.json", "page.jsx", "answers.json", "decisions.json", "story.md"]) fs.copyFileSync(path.join(src, f), path.join(dir, f));
  const casesDir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-cases-"));
  const r = promote({ caseId: "promoted-invoices", from: dir, casesDir });
  const c = readJson(path.join(r.dest, "case.json"));
  assert.equal(c.category, "promoted");
  assert.equal(c.truth["list.number"].uncertain !== undefined, true, "auto-derived matches need review by default");
  assert.match(c.truth["list.requestedBy"].uncertain, /AI/, "the recorded answer was the AI's");
  assert.throws(() => promote({ caseId: "promoted-invoices", from: dir, casesDir }), /exists/);
  const reviewed = promote({ caseId: "promoted-invoices", from: dir, casesDir, acceptAuto: true, force: true });
  assert.ok(reviewed.uncertain < r.uncertain);
});

test("exported labels hold no example values by default, and hashing hides names", () => {
  const dir = path.join(ROOT, "examples", "invoices");
  const text = JSON.stringify(exportLabels(dir));
  for (const secret of ["Kestrel", "Northwind", "INV-10", "Lena", "Prerna", "18400000", "2026-08"]) assert.ok(!text.includes(secret), `leaked ${secret}`);
  assert.ok(!/story|evidence/.test(text.replace(/"decided_by"/g, "")));
  const withValues = JSON.stringify(exportLabels(dir, { includeValues: true }));
  assert.ok(withValues.includes("example"));
  const hashed = JSON.stringify(exportLabels(dir, { hashNames: true }));
  assert.ok(!hashed.includes("requester") && !hashed.includes("amount"), "names hashed");
  const lines = exportLabels(dir);
  assert.ok(lines.length > 0 && lines.every((l) => l.options.length >= 2 && l.chosen >= 0 && ["human", "ai"].includes(l.decided_by)));
});

test("variants plug in through the registry", async () => {
  const { registerVariant } = await import("./variants.mjs");
  assert.throws(() => registerVariant({ name: "x" }), /analyze/);
  assert.throws(() => getVariant("nope"), /unknown variant/);
});

test("truth is split by who vouches for it: independent, synthetic reference, self", async () => {
  const { records, corpus, variant } = await getBase();
  const rep = buildReport({ variant, records, corpus, config });
  const t = rep.headline;
  assert.equal(t.independent.counts.parts + t.reference.counts.parts + t.self.counts.parts, t.all.counts.parts, "every scored part is in exactly one tier");
  assert.ok(t.independent.counts.parts > 0 && t.self.counts.parts > 0 && t.reference.counts.parts > 0);
  // parts Trace settled itself and nobody else vouched for cannot be independent, and cannot show a wrong accept
  assert.equal(t.self.wrong_accepts, 0);
  assert.equal(t.self.precision, 1);
  for (const l of loaded.filter((x) => x.category === "example")) {
    for (const [id, tr] of Object.entries(l.truth)) assert.ok(["independent", "self"].includes(tr.label), `${l.id} ${id} has a label`);
  }
  for (const l of loaded.filter((x) => x.category !== "example")) for (const [id, tr] of Object.entries(l.truth)) assert.equal(tr.label, "reference", `${l.id} ${id}`);
  assert.ok(t.independent.ci95.precision.lo <= t.independent.precision && t.independent.precision <= t.independent.ci95.precision.hi);
  // the report says so, and gives the wrong-accept rate over both denominators wherever it shows the headline
  const md = renderMd(rep), html = renderHtml(rep);
  for (const text of [md, html]) {
    assert.match(text, /[Ll]abel independence/);
    assert.match(text, /REGRESSION detector/);
    const a = rep.headline.all;
    assert.ok(text.includes(`${a.wrong_accepts}/${a.data_parts}`), "denominator: data parts");
    assert.ok(text.includes(`${a.wrong_accepts}/${a.counts.parts}`), "denominator: all parts");
  }
  assert.match(md, /CIRCULAR: measures regression, not accuracy/);
  assert.ok(Math.abs(rep.headline.all.wrong_accept_rate_all_parts - rep.headline.all.wrong_accepts / rep.headline.all.counts.parts) < 1e-4);
});
