import type { MissView } from '../types';

/** im1: where Line missed, per step: the right answer was not offered (a static tool is missing) or offered but not
 * recommended. Plain English first; the most common misses Line did not offer sit under Details. */
export function MissReport({ misses }: { misses: MissView }) {
  const steps = misses.steps.map((s) => (
    <li key={s.step} data-testid="miss-step" data-step={s.step}>
      {s.sentence}
    </li>
  ));
  const top = misses.top.map((t) => <li key={t}>{t}</li>);
  return (
    <div className="ais-misses" data-testid="miss-report" aria-labelledby="ais-misses-title">
      <h3 id="ais-misses-title">Where Line missed</h3>
      <p className="ais-label" data-testid="miss-report-sentence">
        {misses.sentence}
      </p>
      <p className="hint">{misses.from}</p>
      {misses.evals ? <p className="hint" data-testid="miss-report-evals">{misses.evals}</p> : null}
      {steps.length ? <ul className="ais-miss-steps">{steps}</ul> : null}
      {top.length ? (
        <details className="ais-details">
          <summary>Details: what Line did not offer</summary>
          <ul>{top}</ul>
        </details>
      ) : null}
    </div>
  );
}
