#!/usr/bin/env node
// BLIND labelling worksheets for the shipped examples.
//   npm run eval:worksheet [-- --out eval/labeling/worksheets] [-- --case example-roster]
// For every part of a screen the worksheet shows what the DESIGN says (text, examples, column header, surrounding
// words) and what the CONTRACT offers (endpoints, fields with sample values, docs, the story), and leaves the
// answer empty. It never shows Trace's matches, questions, candidates, answers.json, decisions.json or the case's
// current ground truth: the point is a label made without seeing Trace's answer. This file must not import the
// matcher (a test checks that).
//
// Fill `answer.want` (one canonical string, grammar below) in a copy saved to eval/labeling/filled/<caseId>.json,
// set "labeller", and re-run the eval: fold.mjs turns each filled answer into an `independent` label.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import _traverse from "@babel/traverse";
import { parsePage, attr, textOf } from "../../src/extract.mjs";
import { extract } from "../../src/extract.mjs";
import { loadCase, listCaseDirs } from "../adapter.mjs";
import { flatten, refListEndpoint } from "../reference.mjs";
import { here, stable } from "../util.mjs";

const traverse = _traverse.default ?? _traverse;
const kids = (el) => el.children.filter((c) => c.type === "JSXElement");
const tag = (el) => el.openingElement.name.name;

export const GRAMMAR = {
  answer_with_exactly_one_of: {
    "f:<field>|<format>": "a list column shows an item field, e.g. f:lead|asText  (nested fields use dots: spend.value)",
    "a:<agg>(<field>)|<format>": "a page value is an aggregate of the whole list: count(), sum(f), average(f), max(f), min(f), e.g. a:sum(budget)|moneyCompact",
    "e:<path>|<format>": "a page value is a single field of the response outside the list, e.g. e:meta.snapshot_date|dateShort",
    "s:<field>:asc|desc  or  s:none": "how the rows are ordered (s:none = the API's own order)",
    "x:<kind>": "what an action does: create, update, save, remove, select, clear, reload, ignore",
    "gap:todo | gap:custom | gap:static | gap:?": "NOTHING in the contract provides it. todo = leave a TODO, custom = someone writes a placeholder, static = it is fixed text, ? = no view on how it is closed",
    "u:<field>|<recipe>": "it comes from a field but needs a transformation none of the formats below does; describe the recipe in words",
  },
  formats: {
    asText: "the value as is, 12 -> 12, Lena -> Lena",
    moneyCompact: "1234567 -> $1.2M, 45000 -> $45.0K, 900 -> $900",
    moneyFull: "1200 -> $1,200",
    percent: "0.327 -> 32.7%",
    percentWhole: "0.327 -> 33%",
    dateShort: "2026-07-31... -> 31 Jul 2026",
  },
  rules: [
    "Decide from the design text and the contract only. Do not run Trace and do not open answers.json, decisions.json or ai-cache.json.",
    "If two contract fields (or two aggregates) reproduce the design equally well, choose the one the design MEANS (use the header, the surrounding words, the docs and the story) and say why in note.",
    "If you cannot tell, set unsure to true: the part is then left out of every number instead of guessed.",
  ],
};

const flatSample = (items, n = 4) => {
  const fields = {};
  for (const it of items) for (const [k, v] of Object.entries(it)) (fields[k] ??= []).push(v);
  return Object.entries(fields).map(([path, vals]) => ({ path, type: [...new Set(vals.map((v) => (v === null ? "null" : typeof v)))].join("|"), samples: vals.slice(0, n) }));
};

// Design context, from the page source alone.
function designContext(source) {
  const ast = parsePage(source);
  const ctx = { headers: [], rowCells: [], values: {}, actions: [] };
  let root = null;
  traverse(ast, { JSXElement(p) { root = p.node; p.stop(); } });
  const visit = (el, inList) => {
    if (tag(el) === "th") ctx.headers.push(textOf(el));
    if (attr(el, "data-list") && !ctx.rowCells.length) {
      const row = kids(el)[0];
      ctx.rowCells = row ? kids(row).map((cell) => { const dyn = []; const walkCell = (n) => { const d = attr(n, "data-dyn"); if (d) dyn.push(d); kids(n).forEach(walkCell); }; walkCell(cell); return dyn; }) : [];
    }
    kids(el).forEach((c) => visit(c, inList || !!attr(el, "data-list")));
  };
  if (root) visit(root);
  // page values: the words around them (the parent element's text)
  traverse(ast, {
    JSXElement(p) {
      const d = attr(p.node, "data-dyn");
      if (!d) return;
      let list = false, q = p.parentPath;
      while (q) { if (q.node?.type === "JSXElement" && attr(q.node, "data-list")) list = true; q = q.parentPath; }
      if (list) return;
      const parent = p.parentPath.node?.type === "JSXElement" ? p.parentPath.node : null;
      ctx.values[d] = parent ? textOf(parent) : "";
    },
  });
  return ctx;
}

export function buildWorksheet(loaded) {
  const { spec, pageSource, story } = loaded;
  const extracted = extract(pageSource);
  const ctx = designContext(pageSource);
  const { list, items, envScalars } = refListEndpoint(spec);
  const l = extracted.lists[0];
  const colHeader = (name) => { const i = ctx.rowCells.findIndex((c) => c.includes(name)); return i >= 0 ? ctx.headers[i] ?? null : null; };
  const contract = {
    endpoints: (spec.apis ?? []).map((a) => `${a.method} ${a.path}`),
    list_endpoint: list ? `${list.method} ${list.path}${spec.list ? ` (rows are in "${spec.list}")` : ""}` : null,
    item_count: items.length,
    item_fields: flatSample(items),
    response_fields_outside_the_list: Object.entries(envScalars).map(([path, value]) => ({ path, value })),
    docs: spec.docs ?? null,
    requirements_text: story,
  };
  const parts = [];
  const blank = () => ({ want: null, unsure: false, note: "" });
  for (const name of l?.fields ?? []) {
    const cell = ctx.rowCells.find((c) => c.includes(name)) ?? [];
    parts.push({ id: `list.${name}`, what: "a column value repeated in every row", design: { name, header: colHeader(name), examples_in_designed_row_order: l.rows.map((r) => r[name]), other_parts_in_the_same_cell: cell.filter((x) => x !== name) }, answer: blank() });
  }
  if (l) parts.push({ id: "list.sort", what: "the order of the designed rows", design: { designed_rows: l.rows }, api_order_first_rows: items.slice(0, 12), answer: blank() });
  for (const v of extracted.values) parts.push({ id: `value.${v.name}`, what: "a value outside the list", design: { name: v.name, example: v.example, surrounding_text: ctx.values[v.name] ?? "" }, answer: blank() });
  const acts = [...(l?.actions ?? []).map((a) => ({ scope: "row", verb: a })), ...extracted.actions.map((a) => ({ scope: "page", verb: a.name }))];
  for (const a of acts) parts.push({ id: `action.${a.scope}.${a.verb}`, what: "a button or form", design: { verb_marker: a.verb, scope: a.scope }, note_for_labeller: "say what it should do given the endpoints in `contract`", answer: blank() });
  // Trace never appears here: parts are listed from the DESIGN only. Duplicate action ids share one answer.
  const seen = new Set();
  return {
    case: loaded.id,
    labeller: null,
    instructions: GRAMMAR,
    contract,
    parts: parts.filter((p) => (seen.has(p.id) ? false : seen.add(p.id))),
  };
}

export function renderWorksheetMd(ws) {
  const L = [`# Labelling worksheet: ${ws.case}`, "", "Fill `ANSWER` for every part (`UNSURE: yes` if you cannot tell) and put your name after `LABELLER:`; save the file as `eval/labeling/filled/<same name>.md`. (The JSON worksheet of the same name works too: fill `answer.want` and `labeller`.) Do not look at Trace's output, `answers.json`, `decisions.json` or `ai-cache.json`.", "", "LABELLER: ", ""];
  L.push("## How to answer", "");
  for (const [k, v] of Object.entries(ws.instructions.answer_with_exactly_one_of)) L.push(`- \`${k}\`: ${v}`);
  L.push("", "Formats: " + Object.entries(ws.instructions.formats).map(([k, v]) => `\`${k}\` (${v})`).join("; "), "");
  for (const r of ws.instructions.rules) L.push(`- ${r}`);
  L.push("", "## Contract", "", `Endpoints: ${ws.contract.endpoints.join(", ") || "none"}`, `List: ${ws.contract.list_endpoint ?? "none"} (${ws.contract.item_count} items)`, "", "| field | type | samples |", "|---|---|---|");
  for (const f of ws.contract.item_fields) L.push(`| ${f.path} | ${f.type} | ${f.samples.map((s) => JSON.stringify(s)).join(", ")} |`);
  if (ws.contract.response_fields_outside_the_list.length) { L.push("", "Response fields outside the list:", ""); for (const f of ws.contract.response_fields_outside_the_list) L.push(`- \`${f.path}\` = ${JSON.stringify(f.value)}`); }
  if (ws.contract.docs) L.push("", "Contract docs: " + JSON.stringify(ws.contract.docs));
  if (ws.contract.requirements_text) L.push("", "Requirements:", "", ws.contract.requirements_text);
  L.push("", "## Parts", "");
  for (const p of ws.parts) {
    L.push(`### ${p.id}`, "", `${p.what}.`, "");
    L.push("```json", JSON.stringify(p.design, null, 1), "```");
    if (p.api_order_first_rows) L.push("API order (first rows):", "```json", JSON.stringify(p.api_order_first_rows.slice(0, 6)), "```");
    L.push("", "ANSWER: ", "UNSURE: ", "NOTE: ", "");
  }
  return L.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const opt = (n, d) => (a.includes(n) ? a[a.indexOf(n) + 1] : d);
  const out = path.resolve(opt("--out", here("labeling", "worksheets")));
  fs.mkdirSync(out, { recursive: true });
  const only = opt("--case", null);
  let n = 0;
  for (const d of listCaseDirs(here("cases"))) {
    const l = loadCase(d);
    if (l.category !== "example" || (only && l.id !== only)) continue;
    const ws = buildWorksheet(l);
    fs.writeFileSync(path.join(out, `${l.id}.json`), stable(ws) + "\n");
    fs.writeFileSync(path.join(out, `${l.id}.md`), renderWorksheetMd(ws));
    n++;
  }
  console.log(`wrote ${n} blank worksheets to ${out}`);
}
