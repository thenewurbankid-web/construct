import type { CheckModel } from '../types';
import { TechDetails } from './TechDetails';

const check = (c: CheckModel) => (
  <li key={c.id} className="la-check" data-check={c.id} data-state={c.state}>
    <span className={`la-chip la-chip--check-${c.state}`}>{c.label}</span>
    <p className="la-sentence">{c.sentence}</p>
    <TechDetails summary="Details" lines={c.details} />
  </li>
);

/** The verify stage's checks: Line rules, types, tests; each passed, failed or says why it did not run. */
export function VerifyList({ checks }: { checks: CheckModel[] }) {
  if (!checks.length) return null;
  return (
    <section className="la-card" aria-labelledby="la-verify-h" data-testid="la-verify">
      <h2 id="la-verify-h" className="la-h2">Checks</h2>
      <ul className="la-list">{checks.map(check)}</ul>
    </section>
  );
}
