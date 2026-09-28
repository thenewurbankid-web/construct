// The variant registry: how an algorithm idea plugs into the eval.
//
// A variant replaces steps 2-3 of the pipeline (match + build questions). It receives what extract() found and
// the contract, and returns the matched screen plus the questions Trace would ask. Everything downstream (scoring,
// the oracle run, determinism, reports) is the same for every variant, so numbers are comparable.
//
//   analyze(extracted, spec) -> { matched, questions }     required
//   generate(ctx)            -> { files }                  optional; default = src/pipeline.mjs on the case dir
//
// `baseline` is today's code path, unchanged. Other entries are either experiments or negative controls.
import { match } from "../src/match.mjs";
import { buildQuestions } from "../src/ask.mjs";
import { snapshotTies } from "../src/infer.mjs";

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
