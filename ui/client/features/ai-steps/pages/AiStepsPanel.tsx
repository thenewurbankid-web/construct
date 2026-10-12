import { AiStepList } from '../components/AiStepList';
import { MissReport } from '../components/MissReport';
import '../components/ai-steps.css';
import type { AiStepsView } from '../types';

/** Settings' "AI steps": every AI step Line runs, read-only, with its model and how it falls back. */
export function AiStepsPanel({ view }: { view: AiStepsView }) {
  return (
    <section className="ais" data-testid="ai-steps" aria-labelledby="ais-title">
      <div>
        <h2 id="ais-title">AI steps</h2>
        <p className="hint">Every AI step runs on a small local model unless you choose otherwise, and each one falls back to Line&apos;s static checks when the model is not running.</p>
      </div>
      <p className="hint" role="status" data-testid="ai-steps-status">
        {view.status}
      </p>
      <AiStepList rows={view.rows} />
      {view.misses ? <MissReport misses={view.misses} /> : null}
    </section>
  );
}
