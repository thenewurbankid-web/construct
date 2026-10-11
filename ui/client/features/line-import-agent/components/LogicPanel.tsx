import type { LogicModel } from '../types';
import { TechDetails } from './TechDetails';

const missingRow = (u: LogicModel['missing'][number]) => (
  <li key={u.id} className="la-check" data-state="fail">
    <p className="la-sentence">{u.sentence}</p>
    <TechDetails summary="Details" lines={u.details} />
  </li>
);

const stepRow = (s: LogicModel['steps'][number]) => (
  <li key={`${s.n}-${s.status}-${s.line}`} className="la-check" data-testid="la-logic-step" data-state={s.status === 'ok' ? 'pass' : 'fail'}>
    <span className={`la-chip la-chip--check-${s.status === 'ok' ? 'pass' : 'fail'}`}>{s.line}</span>
    <p className="la-sentence">{s.sentence}</p>
  </li>
);

/** The import loop: how many logic units the app has, how many each step kept, what went missing, and the coverage. A step
 * that loses a unit stops the import; the question above says what to do. */
export function LogicPanel({ logic }: { logic: LogicModel | null }) {
  if (!logic) return null;
  return (
    <section className="la-card" aria-labelledby="la-logic-h" data-testid="la-logic">
      <h2 id="la-logic-h" className="la-h2">Logic kept</h2>
      <p className="la-sentence la-kept" data-testid="la-logic-kept">{logic.kept}</p>
      <p className="la-hint" data-testid="la-logic-count">{logic.count}</p>
      <p className="la-hint" data-testid="la-logic-tests" hidden={!logic.tests}>{logic.tests}</p>
      <p className="la-hint" data-testid="la-logic-coverage" hidden={!logic.coverage}>{logic.coverage}</p>
      <ul className="la-list" aria-label="Logic that went missing" hidden={!logic.missing.length}>{logic.missing.map(missingRow)}</ul>
      <details className="la-more" data-testid="la-logic-steps" hidden={!logic.steps.length}>
        <summary>{`Each step's diff (${logic.steps.length})`}</summary>
        <ol className="la-list">{logic.steps.map(stepRow)}</ol>
      </details>
      <TechDetails summary="Details" lines={logic.details} testId="la-logic-details" />
    </section>
  );
}
