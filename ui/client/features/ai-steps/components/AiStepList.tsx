import type { AiStepRow } from '../types';

/** One AI step: its app, what it does, its model and how it decides; the step id and ladder under Details. */
function AiStepItem({ row }: { row: AiStepRow }) {
  const d = row.details;
  return (
    <li className="ais-step" data-testid="ai-step" data-step={row.step}>
      <span className="ais-app">{row.app}</span>
      <p className="ais-label">{row.label}</p>
      <p className="ais-model" data-testid="ai-step-model">
        Model: {row.model}
      </p>
      <p className="ais-how">{row.how}</p>
      <details className="ais-details">
        <summary>Details</summary>
        <ul>
          <li>{d.step}</li>
          <li>{d.cap}</li>
          <li>{d.ladder}</li>
          <li>{d.measured}</li>
          <li>{d.fallback}</li>
        </ul>
      </details>
    </li>
  );
}

/** Every AI step, Cockpit's first. */
export function AiStepList({ rows }: { rows: AiStepRow[] }) {
  const items = rows.map((row) => <AiStepItem key={row.step} row={row} />);
  return (
    <ul className="ais-steps" aria-label="AI steps">
      {items}
    </ul>
  );
}
