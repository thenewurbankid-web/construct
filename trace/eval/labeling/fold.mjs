#!/usr/bin/env node
// Folds a FILLED labelling worksheet (eval/labeling/filled/<caseId>.json) back into a case's ground truth as
// `independent` labels. Nothing here fills a worksheet: labels come from a person or a separate agent that has not
// seen Trace's answers (see worksheet.mjs).
//   node eval/labeling/fold.mjs            validate every filled worksheet and print what it would change
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extract } from "../../src/extract.mjs";
import { referenceExplain } from "../reference.mjs";
import { here, readJson } from "../util.mjs";

export const FILLED_DIR = here("labeling", "filled");

// The canonical wiring grammar (docs/EVAL.md): what an `answer.want` may be.
const WANT = /^(f:[^|\s][^|]*\|[A-Za-z0-9_]+|a:(count|sum|average|max|min)\([^)]*\)\|[A-Za-z0-9_]+|e:[^|\s][^|]*\|[A-Za-z0-9_]+|s:none|s:[^:|\s]+:(asc|desc)|x:[a-z]+|gap:(todo|custom|static|\?)|u:[^|\s][^|]*\|.+)$/;
export const validWant = (w) => typeof w === "string" && WANT.test(w);

// The Markdown worksheet, filled in place: "### part id", then ANSWER / UNSURE / NOTE lines, and one LABELLER line.
export function parseFilledMd(md) {
  const parts = [];
  let cur = null, labeller = null;
  for (const line of md.split("\n")) {
    let m;
    if ((m = /^LABELLER:\s*(.*)$/.exec(line))) labeller = m[1].trim() || null;
    else if ((m = /^### (\S+)\s*$/.exec(line))) parts.push((cur = { id: m[1], answer: { want: null, unsure: false, note: "" } }));
    else if (cur && (m = /^ANSWER:\s*(.*)$/.exec(line))) cur.answer.want = m[1].trim().replace(/^`|`$/g, "") || null;
    else if (cur && (m = /^UNSURE:\s*(.*)$/.exec(line))) cur.answer.unsure = /^(yes|true|y)$/i.test(m[1].trim());
    else if (cur && (m = /^NOTE:\s*(.*)$/.exec(line))) cur.answer.note = m[1].trim();
  }
  return { labeller, parts };
}

// A filled worksheet: eval/labeling/filled/<caseId>.json (the JSON worksheet) or .md (the Markdown one).
export function loadFilled(caseId, dir = FILLED_DIR) {
  const j = path.join(dir, `${caseId}.json`), m = path.join(dir, `${caseId}.md`);
  if (fs.existsSync(j)) return readJson(j);
  return fs.existsSync(m) ? { case: caseId, ...parseFilledMd(fs.readFileSync(m, "utf8")) } : null;
}

// Returns { truth: {partId: entry}, errors: [], skipped: [] }. `loaded` is an adapter case (spec, pageSource, truth).
export function foldWorksheet(filled, loaded) {
  const truth = {}, errors = [], skipped = [];
  const extracted = extract(loaded.pageSource);
  const who = filled.labeller ? String(filled.labeller) : "unnamed labeller";
  for (const p of filled.parts ?? []) {
    const a = p.answer ?? {};
    if (a.want == null || a.want === "") { skipped.push(p.id); continue; }
    if (!validWant(a.want)) { errors.push(`${p.id}: "${a.want}" is not a valid answer (see the grammar in the worksheet)`); continue; }
    const basis = `worksheet filled by ${who}${a.note ? `: ${a.note}` : ""}`;
    if (a.unsure) { truth[p.id] = { uncertain: `the labeller was unsure${a.note ? `: ${a.note}` : ""}`, label: "independent", basis }; continue; }
    let kind = "match";
    if (a.want.startsWith("gap:")) kind = "gap";
    else if (!a.want.startsWith("u:") && !a.want.startsWith("x:")) {
      const E = referenceExplain(loaded.spec, extracted, p.id);
      if (E.includes(a.want) && E.length > 1) kind = "needs-answer";
    }
    const t = { kind, want: a.want === "gap:?" ? "gap:todo" : a.want, label: "independent", basis };
    if (a.want === "gap:?") Object.assign(t, { also: ["gap:custom", "gap:static"], resolutionUnknown: true });
    if (Array.isArray(a.also) && a.also.every(validWant)) t.also = [...(t.also ?? []), ...a.also];
    truth[p.id] = t;
  }
  return { truth, errors, skipped };
}

// Independent labels replace whatever the case said for that part; disagreements are reported, never hidden.
export function applyFilled(loaded) {
  const filled = loadFilled(loaded.id);
  if (!filled) return loaded;
  const { truth, errors } = foldWorksheet(filled, loaded);
  if (errors.length) throw new Error(`eval/labeling/filled/${loaded.id}: ${errors.join("; ")}`);
  const conflicts = [];
  for (const [id, t] of Object.entries(truth)) {
    const prev = loaded.truth[id];
    if (prev && !prev.uncertain && !t.uncertain && prev.want !== t.want) conflicts.push({ part: id, previous: prev.want, previous_label: prev.label ?? "self", independent: t.want });
    loaded.truth[id] = t;
  }
  loaded.labelConflicts = conflicts;
  loaded.independentLabels = Object.keys(truth).length;
  return loaded;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { loadCase } = await import("../adapter.mjs");
  const files = fs.existsSync(FILLED_DIR) ? fs.readdirSync(FILLED_DIR).filter((f) => /\.(json|md)$/.test(f)) : [];
  if (!files.length) console.log("no filled worksheets in eval/labeling/filled (generate blank ones with `npm run eval:worksheet`)");
  for (const f of files) {
    const id = f.replace(/\.(json|md)$/, "");
    const l = loadCase(here("cases", id)); // applyFilled ran inside loadCase; a bad file throws there
    console.log(`${id}: ${l.independentLabels ?? 0} independent labels, ${(l.labelConflicts ?? []).length} disagree with the earlier truth${(l.labelConflicts ?? []).map((c) => `\n  ${c.part}: was ${c.previous} (${c.previous_label}), worksheet says ${c.independent}`).join("")}`);
  }
}
