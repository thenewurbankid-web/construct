// The matched state of one example, computed exactly as a run in auto mode computes it (extract, match, the saved
// answers, no questions, no model), without writing anything. Everything the inspector shows about a part comes from
// here, so it is a pure function of the example's files: feature.json, its openapi contract, the page and answers.json.
import fs from "node:fs";
import path from "node:path";
import { extract } from "../extract.mjs";
import { readSpec } from "../contract.mjs";
import { mergeViewModel, loadViewModel, toExtractedShape } from "../viewmodel.mjs";
import { match } from "../match.mjs";
import { buildQuestions, resolveQuestions } from "../ask.mjs";
import { snapshotTies } from "../infer.mjs";
import { computeHints, openItems } from "../hints.mjs";
import { buildTree } from "../tree/model.mjs";
import { summarize, leafState } from "../ui/vocab.mjs";
import { classify } from "../ui/issues.mjs";
import { resolvePage, analyse, flaggedParts, dataOrCopyOf } from "../pagemap/service.mjs";
import { buildInventory } from "../pagemap/inventory.mjs";
import { sha1 } from "../pagemap/shape.mjs";
import { ifExprParts, ternaryExprParts, switchExprParts } from "./expr-kinds.mjs";

const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return null; } };

export const ANSWERS = "answers.json";
export function readAnswers(dir) {
  try { return JSON.parse(read(path.join(dir, ANSWERS)) ?? "{}"); } catch { return {}; }
}
export const writeAnswers = (dir, answers) => fs.writeFileSync(path.join(dir, ANSWERS), JSON.stringify(answers, null, 2) + "\n");

// The page's own pagemap analysis, for the same example dir, through the same default the Page map's route factory
// uses for `pagesDir` (LIN-158 wiring). `null` when the example has no page a pagemap can analyse (no page, doesn't
// parse, or resolvePage itself rejects it) -- an example without one should never break the inspector.
export function pagemapAnalysisFor(dir) {
  const examplesDir = path.dirname(dir);
  const pagesDir = path.join(examplesDir, "..", "subframe-app", "src", "pages");
  try {
    return analyse(resolvePage({ examplesDir, pagesDir }, { example: path.basename(dir) }));
  } catch {
    return null;
  }
}

// answers: what to resolve with (default: the example's own answers.json). Returns everything derived from it.
export async function computeState(dir, { answers = readAnswers(dir) } = {}) {
  const spec = readSpec(dir); // feature.json + the openapi contract, through the one loader (never feature.json alone)
  const source = fs.readFileSync(path.join(dir, spec.page), "utf8");
  const extracted = extract(source);
  // Merged in memory only (this function writes nothing): the ViewModel is what a real pipeline run matches against.
  const viewExtracted = toExtractedShape(mergeViewModel(loadViewModel(dir), extracted));

  // fresh: the state before any answer, so every part still has all of its options (never mutated after this block)
  const fresh = match(viewExtracted, spec);
  snapshotTies(fresh);
  const hints = computeHints(fresh);
  const qAll = buildQuestions(fresh, { all: true });

  // resolved: the same matching with the answers applied, which is what the generated code is made from
  const resolved = match(viewExtracted, spec);
  snapshotTies(resolved);
  const questions = buildQuestions(resolved);
  await resolveQuestions(questions, { answers, auto: true });
  const tree = buildTree(resolved, spec);
  const open = openItems(resolved, hints);
  const items = Object.fromEntries(open.map((o) => [o.id, o]));

  const parts = [];
  for (const g of tree.groups) for (const leaf of g.leaves) {
    const term = leafState(leaf, { items });
    parts.push({ id: leaf.id, label: leaf.cells[0]?.title ?? leaf.id, group: g.key, term, kind: classify(leaf), item: items[leaf.id] ?? null, leaf });
  }
  // A pagemap id (LIN-158's flaggedParts) that the issue registry flags, so it too can be opened in the Part
  // inspector. Its own analysis, not the tree's, decides its kind and current pick; a page that cannot be
  // analysed here (no page, doesn't parse, ...) simply adds none, same as any other optional section.
  try {
    const pm = pagemapAnalysisFor(dir);
    if (pm) for (const fp of flaggedParts(pm)) {
      parts.push({ id: fp.id, label: fp.label, group: "pagemap", term: "wait", kind: fp.kind, item: null, leaf: null, pagemap: true, pagemapCurrent: dataOrCopyOf(pm, fp.id) });
    }
  } catch { /* an example without a usable page pagemap should not break the inspector */ }
  // Managed-expression kinds (docs/design/mark-as-list-managed-expressions.md): the "if" kind only, so far. A
  // `cond && <X/>` conditional (states.mjs, reused unchanged) with no matching "else" is offered as one more part,
  // keyed by the state record's own id (the "s<hash>" shape inspector.mjs's PART_ID already recognises as openable),
  // so it can be opened, given a "Make it conditional" rule-default option and applied/undone through the existing
  // history mechanism -- without touching the matcher's own answer shape for any real value/list/action part
  // (see options.mjs's "exprkind" scope).
  try {
    for (const p of ifExprParts(source, spec)) {
      parts.push({ id: p.id, label: p.label, group: "exprKind", term: "wait", kind: null, item: null, leaf: null, exprKind: p.exprKind, exprCondition: p.exprCondition, bind: answers[p.id]?.bind ?? null });
    }
  } catch { /* a page the AST can't parse for conditionals should not break the inspector */ }
  try {
    for (const p of ternaryExprParts(source, spec)) {
      parts.push({ id: p.id, label: p.label, group: "exprKind", term: "wait", kind: null, item: null, leaf: null, exprKind: p.exprKind, exprCondition: p.exprCondition, exprElseId: p.exprElseId, bind: answers[p.id]?.bind ?? null });
    }
  } catch { /* a page the AST can't parse for conditionals should not break the inspector */ }
  // The "list" kind (docs/design/mark-as-list-managed-expressions.md §2): a raw `.map()` group the pagemap's
  // own repeated-structure detection already finds (buildInventory's `groups`, `mapped: true`) but that has no
  // `data-list` marker yet -- so the real matcher (extract.mjs/match.mjs) does not see it as a list at all. Each
  // one becomes one more synthetic part, same pattern as "if" above: its own stable id (not the group's own "g"
  // id, which inspector.mjs's PART_ID regex does not recognise as openable), a "Make it a list" rule-default
  // option (options.mjs), applied/undone through the same history mechanism.
  try {
    const inv = buildInventory(source, { file: spec.page });
    for (const g of inv.groups) {
      if (!g.mapped) continue;
      const parent = inv.byId.get(g.parent);
      if (parent?.props?.["data-list"] !== undefined) continue; // already an explicit list: the real matcher owns it
      const node = inv.byId.get(g.members[0]);
      const id = "s" + sha1(`${spec.page}|list|${g.id}`).slice(0, 8);
      parts.push({ id, label: `List: <${node?.tag ?? "?"}>`, group: "exprKind", term: "wait", kind: null, item: null, leaf: null, exprKind: "list", bind: answers[id]?.bind ?? null });
    }
  } catch { /* a page the AST can't parse for repeated groups should not break the inspector */ }
  // The "switch" kind (spec §2): a lookup/dispatch object indexed by a discriminant variable (`LOOKUP[x]`), or a
  // chained ternary with 3+ links (`a===x?A:a===y?B:a===z?C:D`) -- both found directly in a plain value expression's
  // own source text (`buildInventory`'s `textKind:"expression"` text nodes already carry the raw `{...}` contents,
  // no new parsing). A chain with only 2 links stays a plain value (JSX ternaries, `cond ? <X/> : <Y/>`, are the
  // separate "ternary" kind above; a 2-link plain-value chain is not surfaced as any managed kind, same threshold
  // the spec fixes at §2/§10.4 so only one option is ever offered for a given chain).
  try {
    for (const p of switchExprParts(source, spec)) {
      parts.push({ id: p.id, label: p.label, group: "exprKind", term: "wait", kind: null, item: null, leaf: null, exprKind: p.exprKind, exprCondition: p.exprCondition, bind: answers[p.id]?.bind ?? null });
    }
  } catch { /* a page the AST can't parse for lookups/chained ternaries should not break the inspector */ }
  return { dir, spec, source, extracted, fresh, resolved, hints, qAll, tree, open, items, parts, answers, stats: summarize(tree, { items }) };
}

export const partOf = (st, id) => st.parts.find((p) => p.id === id) ?? null;
