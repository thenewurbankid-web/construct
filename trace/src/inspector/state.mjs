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

const read = (f) => { try { return fs.readFileSync(f, "utf8"); } catch { return null; } };

export const ANSWERS = "answers.json";
export function readAnswers(dir) {
  try { return JSON.parse(read(path.join(dir, ANSWERS)) ?? "{}"); } catch { return {}; }
}
export const writeAnswers = (dir, answers) => fs.writeFileSync(path.join(dir, ANSWERS), JSON.stringify(answers, null, 2) + "\n");

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
  return { dir, spec, source, extracted, fresh, resolved, hints, qAll, tree, open, items, parts, answers, stats: summarize(tree, { items }) };
}

export const partOf = (st, id) => st.parts.find((p) => p.id === id) ?? null;
