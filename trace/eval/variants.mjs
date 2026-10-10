// The variant registry: how an algorithm idea plugs into the eval.
//
// A variant replaces steps 2-3 of the pipeline (match + build questions). It receives what extract() found and
// the contract, and returns the matched screen plus the questions Trace would ask. Everything downstream (scoring,
// the oracle run, determinism, reports) is the same for every variant, so numbers are comparable.
//
//   analyze(extracted, spec, { pageSource }) -> { matched, questions }     required (the page source is there for variants that read the design's words)
//   generate(ctx)            -> { files }                  optional; default = src/pipeline.mjs on the case dir
//
// `baseline` is today's code path, unchanged. Other entries are either experiments or negative controls.
import { match } from "../src/match.mjs";
import { buildQuestions } from "../src/ask.mjs";
import { snapshotTies } from "../src/infer.mjs";
import { applyStructural, structuralContext } from "../src/structural-gate.mjs";
import { runPipeline } from "../src/pipeline.mjs";
import { walk, hashOf } from "./util.mjs";
import fs from "node:fs";
import path from "node:path";

const registry = new Map();

export function registerVariant(v) {
  if (!v?.name || typeof v.analyze !== "function") throw new Error("a variant needs a name and analyze()");
  registry.set(v.name, v);
  return v;
}
export const getVariant = (name) => {
  const v = registry.get(name);
  if (!v) throw new Error(`unknown variant "${name}" (known: ${[...registry.keys()].join(", ")})`);
  return v;
};
export const variantNames = () => [...registry.keys()];

// The exact sequence pipeline.mjs runs between extract and ask.
export function baselineAnalyze(extracted, spec) {
  const matched = match(extracted, spec);
  snapshotTies(matched);
  const questions = buildQuestions(matched);
  return { matched, questions };
}

registerVariant({
  name: "baseline",
  describe: "Today's algorithm: brute-force transforms, equal-cost ties become questions. No change.",
  analyze: baselineAnalyze,
});

// Negative control: settles every tie by taking the first candidate instead of asking. It is a bad idea on
// purpose: it shows how many wrong answers the question mechanism prevents, and it is the variant the gate's
// own test degrades to (the gate must fail on it). It also depends on key order, so determinism catches it.
registerVariant({
  name: "tie-first",
  describe: "NEGATIVE CONTROL: never ask about ties, take the first candidate. Should fail the gate.",
  analyze(extracted, spec) {
    const matched = match(extracted, spec);
    snapshotTies(matched);
    for (const f of matched.list?.fields ?? []) if (f.candidates.length > 1) f.candidates = [f.candidates[0]];
    for (const v of matched.values) if (v.candidates.length > 1) v.candidates = [v.candidates[0]];
    if (matched.list && matched.list.sort.length > 1) matched.list.sort = [matched.list.sort[0]];
    return { matched, questions: buildQuestions(matched) };
  },
});

// Ablation: keeps the tie questions but also asks "confirm or pick another" about every single-candidate match
// whose text is short enough to be a coincidence risk (numbers under 100). Shows the price of a cheap
// coincidence guard in extra questions, against the wrong-accepts it catches.
registerVariant({
  name: "confirm-small-numbers",
  describe: "ABLATION: also asks to confirm confident matches whose design value is a bare number below 100.",
  analyze(extracted, spec) {
    const matched = match(extracted, spec);
    snapshotTies(matched);
    const risky = (x) => /^\d{1,2}$/.test(String(x));
    // widening the candidate list to include the "static text" reading is what makes buildQuestions ask
    for (const v of matched.values) if (v.candidates.length === 1 && risky(v.example)) v.candidates = [...v.candidates, { static: true, formatter: "asText", cost: 99 }];
    for (const f of matched.list?.fields ?? []) if (f.candidates.length === 1 && f.examples.every(risky)) f.candidates = [...f.candidates, { static: true, formatter: "asText", cost: 99 }];
    return { matched, questions: buildQuestions(matched) };
  },
});

// T23: structural-coincidence rules + label evidence (src/structural.mjs, src/evidence.mjs, docs/T23.md). A single-candidate
// match that trips a rule AND whose design words do not support the field is asked about (confirm-or-pick) instead of accepted.
registerVariant({
  name: "structural-gate",
  acceptance: { wrong_accept_reduction: 0.5, recall_drop_max: 0.02, questions_increase_max: 0.1, determinism: true },
  describe: "Structural rules + label evidence: a match that is a coincidence of the mock data (count = row count, running number = id, overall max/min, small envelope number) and that the design's words do not vouch for becomes a confirm-or-pick question.",
  analyze(extracted, spec, { pageSource } = {}) {
    const matched = match(extracted, spec);
    snapshotTies(matched);
    applyStructural(matched, structuralContext(pageSource, spec));
    return { matched, questions: buildQuestions(matched) };
  },
  // the generated-file hashes must come from the same code path with the flag on
  async generate({ dir, out, spec }) {
    await runPipeline({ dir, outRoot: out, auto: true, structural: true });
    const base = path.join(out, "features", spec.feature);
    const files = {};
    for (const rel of walk(base).sort()) files[rel] = hashOf(fs.readFileSync(path.join(base, rel), "utf8"));
    return files;
  },
});

// LIN-108: story.md name evidence (src/name-evidence.mjs's storyBestByName, wired in src/match.mjs's storyNarrow).
// A tie that survives matching is narrowed to the one candidate the story text uniquely names, instead of being
// asked about. OFF BY DEFAULT in the pipeline and CLI (--story-evidence) regardless of what this variant measures
// — see src/name-evidence.mjs's header for why: the same coupled-category risk that got `narrowByName` rejected
// (T12.5) applies here, since a story can name a field that happens to line up wrong under shuffling.
registerVariant({
  name: "story-evidence",
  acceptance: { wrong_accept_reduction: 0.5, recall_drop_max: 0.02, questions_increase_max: 0.1, determinism: true },
  describe: "Story.md name tie-break: a tie is narrowed to the one candidate the story's text uniquely names, instead of becoming a question. Measurement only — stays off by default in the pipeline/CLI pending review.",
  analyze(extracted, spec, { story } = {}) {
    const matched = match(extracted, spec, { storyEvidence: true, storyText: story ?? "" });
    snapshotTies(matched);
    return { matched, questions: buildQuestions(matched) };
  },
  // the generated-file hashes must come from the same code path with the flag on
  async generate({ dir, out, spec }) {
    await runPipeline({ dir, outRoot: out, auto: true, storyEvidence: true });
    const base = path.join(out, "features", spec.feature);
    const files = {};
    for (const rel of walk(base).sort()) files[rel] = hashOf(fs.readFileSync(path.join(base, rel), "utf8"));
    return files;
  },
});
