import type { StepRow } from '../types';

/** The plan's steps in order: status, and who does each (Deterministic, Local model, or You). */
export function ProcessSteps({ steps }: { steps: StepRow[] }) {
  return (
    <table className="pr-steps" data-testid="process-steps">
      <thead>
        <tr><th>Step</th><th>Kind</th><th>Status</th></tr>
      </thead>
      <tbody>
        {steps.map((step) => (
          <tr key={step.id} data-testid="process-step" data-status={step.status}>
            <td>
              {step.title}
              {step.note && <span className="pr-step-note">{step.note}</span>}
            </td>
            <td><span className={`pr-kind pr-kind--${step.executor}`}>{step.kind}</span></td>
            <td><span className={`pr-status pr-status--${step.status}`}>{step.statusLabel}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
