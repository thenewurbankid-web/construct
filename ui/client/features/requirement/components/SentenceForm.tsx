import { Button } from '@/components/ui';
import type { SentenceFormProps } from '../types';

/** Step 1: the requirement in plain English, three examples to start from, and "Read it". Nothing typed here goes to a model. */
export function SentenceForm({ view, onText, onExample, onRead }: SentenceFormProps) {
  return (
    <section className="rq-card" aria-labelledby="rq-sentence-h" data-testid="requirement-form">
      <h2 className="rq-h2" id="rq-sentence-h">1. Say what you want</h2>
      <label className="rq-field">
        <span className="rq-label">Requirement</span>
        <textarea
          className="rq-text"
          rows={4}
          value={view.text}
          onChange={(e) => onText(e.target.value)}
          placeholder="A user can see their current plan and click a button to manage billing safely."
          data-testid="requirement-text"
        />
      </label>
      <div className="rq-row" role="group" aria-label="Example sentences">
        <span className="rq-muted">Try an example:</span>
        {view.examples.map((ex) => (
          <button key={ex.id} type="button" className="rq-chip" data-testid={`requirement-example-${ex.id}`} onClick={() => onExample(ex.text)}>
            {ex.label}
          </button>
        ))}
      </div>
      <div className="rq-row">
        <Button type="button" disabled={!view.canRead} onClick={onRead} data-testid="requirement-read">
          {view.busy ? 'Reading...' : 'Read it'}
        </Button>
        <span className="rq-muted" data-testid="requirement-no-model">No model is used: the words are read by fixed rules, so the same sentence always gives the same answer.</span>
      </div>
      {view.error && (
        <p className="rq-error" role="alert" data-testid="requirement-error">
          {view.error}
        </p>
      )}
    </section>
  );
}
