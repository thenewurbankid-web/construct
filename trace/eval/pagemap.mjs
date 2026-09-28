#!/usr/bin/env node
// The Page map measured against the hand-marked example pages. Deterministic and offline (no model, no network).
//   node eval/pagemap.mjs            prints the report and writes eval/out/pagemap.json and eval/out/pagemap.md
//
// Ground truth: the three hand-marked example pages (examples/portfolio-figma-1, -figma-2, portfolio-redesigned/page.jsx),
// which are the SAME designs as the three real Subframe pages (frozen copies in src/import/fixtures/*.tsx, byte-equal to
// subframe-app/src/pages). What the hand pages mark as data-dyn / data-list / data-action is what a designer says is dynamic.
// The comparison is by TEXT (the two files are different markups of one design): a proposal is right when its text is one of
// the hand-marked values or labels, exactly as the import block's own precision test compares.
//
// Two ways to read the numbers:
//   1. proposals: precision and recall of the dynamic / list / action proposals, strong only versus strong plus weak
//   2. the pipeline: accept the proposals on the real page, then run the extractor and the matcher on the result, and count the
//      parts that come out (values + list fields) and the parts matched to exactly one API source, against the hand-marked page
// The old rule set's numbers (src/import/suggest-markers.mjs alone: the "import" column) are recomputed here, not remembered.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { extractParts, suggestMarkers, applyMarkers, RE_TOKEN } from "../src/import/index.mjs";
import { match } from "../src/match.mjs";
import { readSpec } from "../src/contract.mjs";
import { buildInventory } from "../src/pagemap/inventory.mjs";
import { collapse } from "../src/pagemap/collapse.mjs";
import { classify, effectiveOf, coverage } from "../src/pagemap/classify.mjs";
import { contractMatcher } from "../src/pagemap/contract-match.mjs";
import { applyDecisions } from "../src/pagemap/apply.mjs";
import { writeJson, round, here, ROOT } from "./util.mjs";

export const PAGES = [
  { example: "portfolio-figma-1", tsx: "figma-1.tsx", subframe: "PortfolioHealthFigmaRebuild.tsx" },
  { example: "portfolio-figma-2", tsx: "figma-2.tsx", subframe: "PortfolioHealthFigmaRebuild2.tsx" },
  { example: "portfolio-redesigned", tsx: "redesigned.tsx", subframe: "RedesignedPortfolioHealth.tsx" },
];
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
export const norm = (t) => String(t).replace(/[▲▼]/g, "").replace(/[−–]/g, "-").replace(/\s+/g, "").toLowerCase();
const ACTIONABLE = new Set(["dynamic", "list", "action", "input"]);
const pct = (a, b) => (b ? round(a / b, 3) : null);

// what a designer marked in the hand page
function groundTruth(handSource) {
  const parts = extractParts(handSource);
  const dyn = new Set([...parts.values.map((v) => norm(v.example)), ...parts.lists.flatMap((l) => l.rows.flatMap((r) => Object.values(r).map(norm)))]);
  const inv = buildInventory(handSource, { file: "hand.jsx" });
  const actions = new Set();
  for (const n of inv.nodes) if (n.kind === "interaction" && typeof n.props["data-action"] === "string") actions.add(norm(n.details.label));
  const list = parts.lists[0] ? { rows: parts.lists[0].rows.length, first: Object.values(parts.lists[0].rows[0] ?? {}).map(norm) } : null;
  return { dyn, actions, list, parts };
}

// the text a dynamic proposal stands for (a number inside a sentence stands for the number).
// A "strong" proposal is either an exact-value match or already carries `tokens` (the part of the sentence that
// equals a contract value); either way its own text is the fair comparison. A "weak" proposal has no such anchor
// and is often a whole label the rule flagged only because a value sits inside it ("the number is part of a
// phrase" - see suggest-markers' RE_LABELLED_NUMBER/unitSuffix reasons); the hand-marked page usually marks just
// that value, not the label wording around it. Comparing the whole label text alone would count an accepted,
// correct proposal as a miss just because the surrounding words differ, so a weak proposal without tokens is also
// compared by any value token embedded in it (same RE_TOKEN suggest-markers uses to find them), in addition to
// its full text. This only widens what a proposal is understood to stand for, on nodes the rules already flagged
// as data; it does not touch classification, and it cannot help a proposal that has no value token, or a truly
// wrong one, since `score()` still requires an exact normalized match.
const textsOf = (n, p, source) => {
  if (n.kind !== "text" || n.textKind === "attribute") return [];
  if (p.tokens) return p.tokens.map((t) => source.slice(t.start, t.end));
  if (p.strength !== "weak") return [n.text];
  const embedded = [...n.text.matchAll(RE_TOKEN)].map((m) => m[0]);
  return embedded.length ? [n.text, ...embedded] : [n.text];
};

function score(items, truth) {
  const hit = items.filter((t) => truth.has(norm(t)));
  const covered = new Set(items.map(norm));
  const recalled = [...truth].filter((g) => covered.has(g));
  return { proposed: items.length, right: hit.length, precision: pct(hit.length, items.length), recall: pct(recalled.length, truth.size), truth: truth.size };
}

function partsOf(source, spec) {
  const ex = extractParts(source);
  const m = match(ex, spec);
  const all = [...m.values, ...(m.list?.fields ?? [])];
  return { extracted: ex.values.length + ex.lists.reduce((n, l) => n + l.fields.length, 0), matched: all.filter((v) => v.candidates.length === 1).length, lists: ex.lists.length, actions: ex.actions.length };
}

/**
 * Run the measurement.
 *
 * @param {{pages?: typeof PAGES}} [opts] Pages to measure (default: the three real Subframe pages).
 * @returns {object} The report (sorted, no clock: two runs are byte-identical).
 */
export function runPagemapEval({ pages = PAGES } = {}) {
  const out = { schema: 1, pages: {}, note: "Ground truth = the hand-marked example pages; compared by text. See eval/pagemap.mjs." };
  for (const pg of pages) {
    const dir = path.join(ROOT, "examples", pg.example);
    const source = read("src", "import", "fixtures", pg.tsx);
    const truth = groundTruth(fs.readFileSync(path.join(dir, "page.jsx"), "utf8"));
    const inv = buildInventory(source, { file: pg.subframe });
    const cx = collapse(inv);
    const contract = contractMatcher(dir);
    const { proposals, issues, follow } = classify(inv, cx, source, { contract });
    const noContract = classify(inv, cx, source, { contract: null });
    const eff = Object.fromEntries(inv.nodes.filter((n) => n.id !== "root").map((n) => [n.id, effectiveOf(n, proposals[n.id], undefined)]));
    const cov = coverage(inv, eff);
    const nodes = inv.nodes.filter((n) => n.id !== "root");
    const text = nodes.filter((n) => n.kind === "text");
    const roots = nodes.filter((n) => !follow[n.id]);
    const byClass = {};
    for (const n of roots) { const p = proposals[n.id]; if (p.cls === "structure" || p.delegate) continue; byClass[p.cls] ??= { strong: 0, weak: 0 }; byClass[p.cls][p.strength]++; }

    // 1. proposals versus the hand-marked page
    const dynStrong = [], dynAll = [];
    for (const n of text) {
      const p = proposals[n.id];
      const t = textsOf(n, p, source);
      if (p.cls === "dynamic" && p.strength === "strong") { dynStrong.push(...t); dynAll.push(...t); }
      else if (p.cls === "dynamic" || (p.cls === "unsure" && p.lean === "dynamic")) dynAll.push(...t);
    }
    // the import block's own suggestions, for comparison
    const sug = suggestMarkers(source).filter((s) => s.kind === "dyn");
    const oldStrong = sug.filter((s) => s.strength === "strong").map((s) => s.text), oldAll = sug.map((s) => s.text);
    const actionLabel = (n) => norm(n.details.label);
    const actStrong = nodes.filter((n) => n.kind === "interaction" && proposals[n.id].cls === "action" && proposals[n.id].strength === "strong").map(actionLabel);
    const actAll = nodes.filter((n) => n.kind === "interaction" && proposals[n.id].cls === "action").map(actionLabel);
    const oldAct = suggestMarkers(source).filter((s) => s.kind === "action");
    const listNodes = nodes.filter((n) => (n.kind === "list" || n.kind === "table") && proposals[n.id].cls === "list" && !proposals[n.id].delegate);
    const listOk = (n) => {
      if (!truth.list) return false;
      const rows = n.details.rowCount ?? 0;
      const g = cx.groups.find((x) => x.parent === n.id);
      const first = g ? inv.byId.get(g.template) : null;
      const texts = new Set();
      const walk = (id) => { const c = inv.byId.get(id); if (c.kind === "text") texts.add(norm(c.text)); else c.children.forEach(walk); };
      if (first) walk(first.id);
      const overlap = truth.list.first.filter((t) => texts.has(t)).length;
      return (rows === truth.list.rows || (g && g.count === truth.list.rows)) && overlap >= Math.ceil(truth.list.first.length / 2);
    };
    const lists = { truth_rows: truth.list?.rows ?? 0, strong: listNodes.filter((n) => proposals[n.id].strength === "strong").length, all: listNodes.length, correct: listNodes.filter(listOk).length, correctStrong: listNodes.filter((n) => proposals[n.id].strength === "strong" && listOk(n)).length };

    // 2. the pipeline on the marked page
    const spec = readSpec(dir);
    const ctx = { inv, cx, proposals, source, follow };
    const decisionsFor = (pred) => Object.fromEntries(roots.filter((n) => { const p = proposals[n.id]; const c = p.cls === "unsure" ? p.lean : p.cls; return ACTIONABLE.has(c) && !p.existing && pred(p, c); }).map((n) => [n.id, { act: "accept", by: "rule" }]));
    const marked = (pred) => { try { return applyDecisions(ctx, decisionsFor(pred)).source; } catch { return null; } };
    const pipeline = {
      hand: partsOf(fs.readFileSync(path.join(dir, "page.jsx"), "utf8"), spec),
      import_strong: partsOf(applyMarkers(source, suggestMarkers(source).filter((s) => s.strength === "strong").map((s) => s.id)), spec),
      pagemap_strong: partsOf(marked((p) => p.strength === "strong" && p.cls !== "unsure"), spec),
      pagemap_strong_plus_weak_fields: partsOf(marked((p, c) => p.strength === "strong" ? p.cls !== "unsure" : c !== "list"), spec),
    };
    out.pages[pg.subframe] = {
      example: pg.example,
      nodes: { total: cov.total, collapsed_visible: cx.stats.visible, repeated_groups: cx.stats.groups, repeated_components: cx.stats.components },
      coverage: { dynamic: cov.dynamic, static: cov.static, list: cov.list, action: cov.action, input: cov.input, visual: cov.visual, structure: cov.structure, unsure: cov.unsure, accounted_for_percent: cov.accountedFor },
      text_nodes: { total: text.length, dynamic: text.filter((n) => proposals[n.id].cls === "dynamic").length, static: text.filter((n) => proposals[n.id].cls === "static").length, unsure: text.filter((n) => proposals[n.id].cls === "unsure").length, strong: text.filter((n) => proposals[n.id].strength === "strong").length, classified_percent: pct(text.length, text.length) * 100 },
      unclassified_text: Object.values(issues).filter((k) => k === "unclassified").length,
      ambiguous_text: Object.values(issues).filter((k) => k === "ambiguous").length,
      suggestions_by_class: byClass,
      dynamic: { pagemap_strong: score(dynStrong, truth.dyn), pagemap_strong_plus_weak: score(dynAll, truth.dyn), import_strong: score(oldStrong, truth.dyn), import_strong_plus_weak: score(oldAll, truth.dyn), without_contract_strong: score(noContract.proposals && text.filter((n) => noContract.proposals[n.id].cls === "dynamic" && noContract.proposals[n.id].strength === "strong").flatMap((n) => textsOf(n, noContract.proposals[n.id], source)), truth.dyn) },
      lists,
      actions: { truth: truth.actions.size, pagemap_strong: score(actStrong, truth.actions), pagemap_strong_plus_weak: score(actAll, truth.actions), import: score(oldAct.map((s) => s.text), truth.actions) },
      pipeline,
    };
  }
  return out;
}

export function renderMd(rep) {
  const L = ["# Page map eval", "", rep.note, ""];
  const f = (x) => (x === null ? "n/a" : `${Math.round(x * 100)}%`);
  for (const [name, r] of Object.entries(rep.pages)) {
    L.push(`## ${name} (against examples/${r.example})`, "");
    L.push(`Nodes ${r.nodes.total}, shown collapsed ${r.nodes.collapsed_visible}; ${r.nodes.repeated_groups} repeated groups, ${r.nodes.repeated_components} repeated components. Text nodes ${r.text_nodes.total}: ${r.text_nodes.dynamic} dynamic, ${r.text_nodes.static} static, ${r.text_nodes.unsure} unsure (100% accounted for; ${r.text_nodes.strong} with a strong proposal).`, "");
    L.push("| dynamic proposals | proposed | right | precision | recall of the hand-marked values |", "|---|---:|---:|---:|---:|");
    for (const k of ["pagemap_strong", "pagemap_strong_plus_weak", "import_strong", "import_strong_plus_weak", "without_contract_strong"]) L.push(`| ${k} | ${r.dynamic[k].proposed} | ${r.dynamic[k].right} | ${f(r.dynamic[k].precision)} | ${f(r.dynamic[k].recall)} |`);
    L.push("", `Lists: hand-marked one list of ${r.lists.truth_rows} rows; page map proposed ${r.lists.all} (strong ${r.lists.strong}); correct ${r.lists.correct} (strong ${r.lists.correctStrong}).`);
    L.push(`Actions: hand-marked ${r.actions.truth}; page map strong ${r.actions.pagemap_strong.proposed} (precision ${f(r.actions.pagemap_strong.precision)}, recall ${f(r.actions.pagemap_strong.recall)}); strong+weak ${r.actions.pagemap_strong_plus_weak.proposed} (precision ${f(r.actions.pagemap_strong_plus_weak.precision)}, recall ${f(r.actions.pagemap_strong_plus_weak.recall)}); import rules ${r.actions.import.proposed} (precision ${f(r.actions.import.precision)}, recall ${f(r.actions.import.recall)}).`, "");
    L.push("| pipeline on the marked page | parts extracted | matched to one source |", "|---|---:|---:|");
    for (const [k, v] of Object.entries(r.pipeline)) L.push(`| ${k} | ${v.extracted} | ${v.matched} |`);
    L.push("");
  }
  return L.join("\n") + "\n";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const rep = runPagemapEval();
  writeJson(here("out", "pagemap.json"), rep);
  fs.writeFileSync(here("out", "pagemap.md"), renderMd(rep));
  console.log(renderMd(rep));
}
