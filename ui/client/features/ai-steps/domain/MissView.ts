import type { MissReportView, MissView } from '../types';

const pct = (x: number) => `${Math.round(x * 100)}%`;

/** im1: the miss report in plain English: the total, one sentence per step, the top patterns Line did not offer. */
export function missView(r: MissReportView): MissView {
  const t = r.numbers?.train;
  const d = r.numbers?.drafter;
  const evals = [t ? `Train Line held-out: ${pct(t.recall)} of the valid routes found, ${pct(t.preferred)} picked the preferred one.` : null, d ? `Drafter eval: ${pct(d.recall)} route recall, ${pct(d.precision)} precision.` : null].filter(Boolean).join(' ');
  return { sentence: r.sentence, from: r.from, steps: r.steps.map((s) => ({ step: s.step, sentence: s.sentence })), top: r.topAbsent.map((p) => p.sentence), evals: evals || null };
}
