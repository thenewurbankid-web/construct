import { Button } from '@/components/ui';
import type { ProofView } from '../types';

type ProofActionsProps = { proof: ProofView; onRun: () => void; onSkipOpen: () => void };

/** The buttons of the proof: run first, then the closed options of the summary. Run and skip work; the rest say what they will do and why they are off. */
export function ProofActions({ proof, onRun, onSkipOpen }: ProofActionsProps) {
  const handlers = { run: onRun, skip: onSkipOpen, off: undefined };
  return (
    <>
      <div className="rq-row" data-testid="proof-actions">
        {proof.buttons.map((b) => (
          <Button key={b.id} type="button" variant={b.variant} disabled={b.disabled} onClick={handlers[b.action]} data-testid={b.testId} title={b.why}>{b.label}</Button>
        ))}
      </div>
      {proof.runReason && <p className="rq-muted" data-testid="proof-run-reason">{proof.runReason}</p>}
      <ul className="rq-proof-options" aria-label="What the other options will do" data-testid="proof-option-notes">
        {proof.notes.map((n) => <li key={n.id} className="rq-muted" data-testid="proof-option-note" data-option={n.id}>{n.text}</li>)}
      </ul>
    </>
  );
}
