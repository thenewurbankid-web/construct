import type { ProofCardProps } from '../types';
import { ProofActions } from './ProofActions';
import { ProofFailure } from './ProofFailure';
import { ProofSkipForm } from './ProofSkipForm';

const TONE = { muted: 'rq-muted', error: 'rq-error' } as const;

/**
 * Step 6: the proof of the generated screen. A screen is done when it is proven: the chain reads incomplete until the proof is
 * green or skipped on purpose with a reason. Approving the plan (step 5) and running the proof are separate steps; the proof runs
 * against the files the plan wrote, so it stays off until they are in the project. The run is read-only and needs no browser.
 */
export function ProofCard({ proof, onRun, onSkipOpen, onSkipDraft, onSkipConfirm, onSkipCancel }: ProofCardProps) {
  return (
    <section className="rq-card" aria-labelledby="rq-proof-h" data-testid="requirement-proof" data-state={proof.state} data-complete={String(proof.chain.complete)}>
      <h2 className="rq-h2" id="rq-proof-h">6. Prove the screen</h2>
      <p className="rq-muted">A generated screen is done when it is shown to work: its four states, its controller and its service, checked with no browser and no model.</p>
      <div className="rq-row">
        <span className={`rq-badge rq-badge--proof-${proof.state}`} data-testid="proof-state" data-state={proof.state}><span aria-hidden="true">{proof.symbol} </span>{proof.stateLabel}</span>
        <span data-testid="proof-headline">{proof.headline}</span>
      </div>
      <p data-testid="proof-chain" data-complete={String(proof.chain.complete)}><strong>Chain:</strong> {proof.chain.line}</p>
      {proof.notices.map((n) => (
        <p key={n.id} className={TONE[n.tone]} role={n.role} data-testid={`proof-${n.id}`}>{n.text}</p>
      ))}
      {proof.failures.map((f) => <ProofFailure key={`${f.heading}:${f.summary}`} failure={f} />)}
      <ProofActions proof={proof} onRun={onRun} onSkipOpen={onSkipOpen} />
      {proof.skip.open && <ProofSkipForm skip={proof.skip} onDraft={onSkipDraft} onConfirm={onSkipConfirm} onCancel={onSkipCancel} />}
    </section>
  );
}
