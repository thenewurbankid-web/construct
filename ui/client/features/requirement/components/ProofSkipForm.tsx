import { Button } from '@/components/ui';
import type { ProofSkipView } from '../types';

type ProofSkipFormProps = { skip: ProofSkipView; onDraft: (draft: string) => void; onConfirm: () => void; onCancel: () => void };

/** Skipping the proof needs a reason: it is recorded, and the chain summary shows it ("complete (proof skipped: ...)"). */
export function ProofSkipForm({ skip, onDraft, onConfirm, onCancel }: ProofSkipFormProps) {
  return (
    <form className="rq-skip" data-testid="proof-skip-form" onSubmit={(e) => { e.preventDefault(); onConfirm(); }}>
      <label className="rq-label" htmlFor="rq-skip-reason">Why skip the proof? The reason is recorded and shown in the chain summary.</label>
      <input id="rq-skip-reason" className="rq-text rq-input" type="text" autoComplete="off" maxLength={skip.max + 40} value={skip.draft} disabled={skip.saving} onChange={(e) => onDraft(e.target.value)} data-testid="proof-skip-reason" aria-describedby="rq-skip-hint" aria-invalid={skip.invalid} />
      <p className="rq-muted" id="rq-skip-hint">{skip.hint}</p>
      <div className="rq-row">
        <Button type="submit" disabled={skip.saving} data-testid="proof-skip-confirm">{skip.confirmLabel}</Button>
        <Button type="button" variant="ghost" disabled={skip.saving} onClick={onCancel} data-testid="proof-skip-cancel">Cancel</Button>
      </div>
      {skip.error && <p className="rq-error" role="alert" data-testid="proof-skip-error">{skip.error}</p>}
    </form>
  );
}
