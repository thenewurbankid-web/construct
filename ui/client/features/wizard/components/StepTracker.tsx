import { GlassPanel } from '@/components/ui';
import type { WizardStep } from '../domain/WizardSteps';

const MARK: Record<WizardStep['status'], string> = { pending: '○', active: '●', done: '✓', skipped: '–', cancelled: '✕', stopped: '■' };

// Presentation-only (#599): the framework's blocks in run order. The one running now is highlighted
// (`aria-current="step"`); this list is only ever deterministic Construct phases, never model output.
export function StepTracker({ steps, running, cancelling, onCancel }: { steps: WizardStep[]; running: boolean; cancelling: boolean; onCancel: () => void }) {
  return (
    <GlassPanel as="aside" className="step-tracker" aria-label="Import blocks">
      <h2>Blocks</h2>
      <ol>
        {steps.map((s) => (
          <li key={s.phase} className={`step-tracker__item step-tracker__item--${s.status}`} aria-current={s.status === 'active' ? 'step' : undefined} data-phase={s.phase}>
            <span className="step-tracker__mark" aria-hidden="true">{MARK[s.status]}</span>
            <span className="step-tracker__label">{s.label}</span>
            {s.status === 'active' && s.note && <span className="step-tracker__note">{s.note}</span>}
          </li>
        ))}
      </ol>
      {running && (
        <button type="button" className="step-tracker__cancel" onClick={onCancel} disabled={cancelling}>
          {cancelling ? 'Cancelling…' : 'Cancel'}
        </button>
      )}
    </GlassPanel>
  );
}
