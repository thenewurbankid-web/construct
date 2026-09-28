// Evaluates one case under one variant: blind run (what Trace does with no answers), oracle run (every question
// answered with the ground truth), determinism. Returns a record of integers, verdicts and (separately) timings.
import path from "node:path";
import { extract } from "../src/extract.mjs";
import { resolveQuestions } from "../src/ask.mjs";
import { describeParts, finalWiring, oracleValue } from "./truth.mjs";
import { scorePart, countsFrom, LABELS } from "./metrics.mjs";
import { fingerprint, checkDeterminism, stableFingerprint } from "./determinism.mjs";

const now = () => performance.now(); // timing only

// resolveQuestions in auto mode applies the saved answers and leaves everything else open: no I/O, no prompts.
export async function oracleRun(loaded, variant, extracted) {
  const { matched, questions } = variant.analyze(extracted, loaded.spec);
  const parts = describeParts(matched, questions);
  const answers = {};
  for (const p of parts) {
    const t = loaded.truth[p.id];
    if (!t || t.uncertain) continue;
    const q = questions.find((x) => x.id === p.qid && !x.sub);
    if (!q) continue;
    const v = oracleValue(t.want, p, q.options);
    if (v != null) answers[p.qid] = v;
  }
  await resolveQuestions(questions, { answers, auto: true });
  return { final: finalWiring(matched, { endpoint: !!loaded.truth["endpoint.list"] }), answered: Object.keys(answers).length };
}

export async function evaluateCase(loaded, variant, { workRoot, determinism = true } = {}) {
  const truth = loaded.truth ?? {};
  const t0 = now();
  const extracted = extract(loaded.pageSource);
  const t1 = now();
  const { matched, questions } = variant.analyze(extracted, loaded.spec);
  const t2 = now();
  const parts = describeParts(matched, questions, { endpoint: !!truth["endpoint.list"] });
  const verdicts = parts.map((p) => scorePart(p, truth[p.id]));
  const orphans = Object.keys(truth).filter((k) => !parts.some((p) => p.id === k));
  const oracle = await oracleRun(loaded, variant, extracted);
  const counts = countsFrom(verdicts, truth, oracle.final);
  // The same counts per label tier, so independent truth can be reported apart from circular truth.
  const counts_by_label = {};
  for (const lab of LABELS) {
    const c = countsFrom(verdicts.filter((v) => v.label === lab), truth, oracle.final);
    c.screens = c.parts + c.uncertain > 0 ? 1 : 0;
    counts_by_label[lab] = c;
  }

  const rec = {
    id: loaded.id, category: loaded.category, counts, counts_by_label, orphans,
    n_parts: parts.length,
    verdicts: verdicts.filter((v) => v.status === "scored").map((v) => ({
      id: v.id, cls: v.cls, kind: v.kind, want: v.want, outcome: v.outcome, accepted: v.accepted, default: v.default,
      correct: v.correct, wrong: v.wrong, necessary: v.necessary ?? null, coincidence: v.coincidence, couple: v.couple,
      library: v.library, nOptions: v.nOptions, nCandidates: v.nCandidates, answerAvailable: v.answerAvailable ?? null,
      options: parts.find((p) => p.id === v.id)?.options ?? [], candidates: parts.find((p) => p.id === v.id)?.candidates ?? [], name: parts.find((p) => p.id === v.id)?.name ?? null,
      final: oracle.final[v.id] ?? null,
    })),
    timing: { extract_ms: t1 - t0, analyze_ms: t2 - t1 },
  };

  if (workRoot) {
    const w = path.join(workRoot, loaded.id);
    const base = await fingerprint(loaded, variant, loaded.spec, path.join(w, "base"));
    rec.timing.pipeline_ms = base.pipelineMs; // src/pipeline.mjs end to end: extract, match, questions, plan, emit, prettier
    rec.fingerprint = stableFingerprint(base);
    if (determinism) rec.determinism = await checkDeterminism(loaded, variant, base, w);
  }
  return rec;
}
