import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildWorksheet, renderWorksheetMd } from "./worksheet.mjs";
import { foldWorksheet, parseFilledMd, validWant, loadFilled, applyFilled } from "./fold.mjs";
import { loadCase } from "../adapter.mjs";
import { here } from "../util.mjs";

const roster = () => loadCase(here("cases", "example-roster"));

test("a worksheet lists every part from the design and shows no Trace answer", () => {
  const l = roster();
  const ws = buildWorksheet(l);
  const ids = ws.parts.map((p) => p.id);
  for (const id of Object.keys(l.truth)) assert.ok(ids.includes(id), `${id} is on the worksheet`);
  assert.ok(ws.parts.every((p) => p.answer.want === null && p.answer.unsure === false));
  const text = JSON.stringify(ws) + renderWorksheetMd(ws);
  // no field of the truth, no candidate, no accepted/asked marker
  for (const bad of ['"accepted"', '"candidates"', '"truth"', '"kind":"match"', "trace-accepted", "needs-answer", "decisions.json\": "]) assert.ok(!text.includes(bad), `worksheet leaks ${bad}`);
  const owner = ws.parts.find((p) => p.id === "list.owner");
  assert.equal(owner.design.header, "Owner");
  assert.deepEqual(owner.design.examples_in_designed_row_order, ["Lena", "Arjun", "Mia"]);
  assert.ok(ws.contract.item_fields.some((f) => f.path === "deputy" && f.samples.includes("Lena")));
});

test("the worksheet generator never imports the matcher or the case truth", () => {
  const src = fs.readFileSync(here("labeling", "worksheet.mjs"), "utf8");
  for (const forbidden of ["src/match.mjs", "src/ask.mjs", "src/hints.mjs", "src/ai/", "truth.mjs", "derive.mjs", "variants.mjs", "answers.json\"", "evaluate.mjs"]) {
    assert.ok(!new RegExp(`import[^\\n]*${forbidden.replace(/[./]/g, "\\$&")}`).test(src), `imports ${forbidden}`);
  }
});

test("a filled worksheet folds into independent labels; kinds come from the reference, not from Trace", () => {
  const l = roster();
  const ws = buildWorksheet(l);
  const fill = (id, want, extra = {}) => Object.assign(ws.parts.find((p) => p.id === id).answer, { want, ...extra });
  fill("list.owner", "f:lead|asText", { note: "story: Owner is the project lead" });
  fill("list.project", "f:project|asText");
  fill("value.projectCount", "a:count()|asText");
  fill("value.plannedTotal", "gap:?", { unsure: false });
  fill("value.forecastTotal", "a:sum(forecast)|moneyCompact", { unsure: true });
  ws.labeller = "test labeller";
  const r = foldWorksheet(ws, l);
  assert.deepEqual(r.errors, []);
  assert.equal(r.truth["list.owner"].kind, "needs-answer", "lead and deputy tie in the data");
  assert.equal(r.truth["list.owner"].label, "independent");
  assert.match(r.truth["list.owner"].basis, /test labeller/);
  assert.equal(r.truth["list.project"].kind, "match");
  assert.equal(r.truth["value.plannedTotal"].kind, "gap");
  assert.ok(r.truth["value.forecastTotal"].uncertain, "unsure parts are excluded");
  assert.ok(r.skipped.includes("list.backup"), "unanswered parts keep their earlier truth");
});

test("bad answers are refused; the Markdown worksheet parses too", () => {
  assert.equal(validWant("f:lead|asText"), true);
  assert.equal(validWant("a:sum(budget)|moneyCompact"), true);
  assert.equal(validWant("s:amount:desc"), true);
  assert.equal(validWant("lead"), false);
  assert.equal(validWant("gap:maybe"), false);
  const l = roster();
  const ws = buildWorksheet(l);
  ws.parts[0].answer.want = "lead";
  assert.equal(foldWorksheet(ws, l).errors.length, 1);
  const md = "LABELLER: Sam\n\n### list.owner\n\nANSWER: `f:lead|asText`\nUNSURE: \nNOTE: story says lead\n\n### list.backup\nANSWER: \nUNSURE: yes\nNOTE: \n";
  const p = parseFilledMd(md);
  assert.equal(p.labeller, "Sam");
  assert.equal(p.parts[0].answer.want, "f:lead|asText");
  assert.equal(p.parts[1].answer.want, null);
  assert.equal(p.parts[1].answer.unsure, true);
});

test("applyFilled replaces the case's truth with independent labels and reports disagreements", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "eval-filled-"));
  const l = roster();
  const ws = buildWorksheet(l);
  ws.labeller = "test";
  ws.parts.find((p) => p.id === "list.project").answer.want = "f:project|asText";
  ws.parts.find((p) => p.id === "list.owner").answer.want = "f:deputy|asText"; // disagrees with the earlier truth (lead)
  fs.writeFileSync(path.join(dir, "example-roster.json"), JSON.stringify(ws));
  const filled = loadFilled("example-roster", dir);
  assert.equal(filled.labeller, "test");
  // apply against an isolated copy (applyFilled reads the real filled dir, so fold directly)
  const r = foldWorksheet(filled, l);
  const merged = { ...l.truth, ...r.truth };
  assert.equal(merged["list.project"].label, "independent", "was self-labelled, now independent");
  assert.equal(merged["list.owner"].want, "f:deputy|asText");
  assert.equal(typeof applyFilled, "function");
});
