'use client';

// #748 (R6) -- the R4 read-back (#672) rendered beside the table: every original requirement sentence, tagged
// covered / out-of-scope / uncovered. This IS the "diff against the original requirement" the acceptance
// criteria asks for -- not a text diff, but the same sentence-by-sentence accounting the CLI's `--read-back`
// prints, so nothing the person wrote is silently dropped.
import { coverageSummary, sentenceViews } from '../domain/SpecBreakdownView';
import type { ReadBack } from '../types';

export function ReadBackPanel({ readBack }: { readBack: ReadBack }) {
  return (
    <section className="sb-readback" data-testid="sb-readback">
      <h3>Read-back</h3>
      <p className="sb-readback-summary" data-testid="sb-readback-summary">{readBack.summary}</p>
      <ol className="sb-sentences">
        {sentenceViews(readBack).map((s) => (
          <li key={s.id} className={`sb-sentence sb-sentence--${s.tone}`} data-testid="sb-sentence" data-status={s.status}>
            <span className="sb-sentence-text">{s.text}</span>
            {s.status === 'out-of-scope' && <span className="sb-sentence-reason"> — out of scope: {s.reason}</span>}
            {s.status === 'uncovered' && <span className="sb-sentence-reason"> — not covered by anything.</span>}
          </li>
        ))}
      </ol>
      <p className="sb-coverage" data-testid="sb-coverage">{coverageSummary(readBack)}</p>
    </section>
  );
}
