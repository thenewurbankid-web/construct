import { Button } from '@/components/ui';
import type { ProofCardProps, ProofFailureView } from '../types';

function Failure({ f }: { f: ProofFailureView }) {
  const tone = f.kind === 'app' ? 'rq-fail rq-fail--app' : f.kind === 'convention' ? 'rq-fail rq-fail--convention' : 'rq-fail';
  return (
    <section className={tone} data-testid="proof-failure" data-kind={f.kind} aria-label={`Why "${f.test}" failed`}>
      <h3 className="rq-h3-plain"><span aria-hidden="true">{f.kind === 'app' ? '✗ ' : '⚠ '}</span>{f.heading}</h3>
      <p data-testid="proof-failure-summary">{f.summary}</p>
      {f.failingState && (
        <p data-testid="proof-failing-state">Failing state: <code>{f.failingState}</code>{f.reached ? <>, the screen reached <code>{f.reached}</code></> : null}</p>
      )}
      <p className="rq-muted">Test: {f.test}</p>
      {f.kind === 'convention' && f.expected && <p className="rq-muted">Looked for: <code>{f.expected}</code></p>}
      {f.kind !== 'app' && f.message && <pre className="rq-pre" tabIndex={0} aria-label="What the proof said, as text" data-testid="proof-failure-message">{f.message}</pre>}
      {f.fix && <p><strong>How to fix it.</strong> {f.fix}</p>}
      {f.kind === 'app' && <p className="rq-muted">The proof found what it binds to, so this one is worth fixing in the screen.</p>}
    </section>
  );
}

/**
 * Step 6: the proof of the generated screen. A screen is done when it is proven: the chain reads incomplete until the proof is
 * green or skipped on purpose with a reason. Approving the plan (step 5) and running the proof are separate steps; the proof runs
 * against the files the plan wrote, so it stays off until they are in the project. The run is read-only and needs no browser.
 */
export function ProofCard({ proof, onRun, onSkipOpen, onSkipDraft, onSkipConfirm, onSkipCancel }: ProofCardProps) {
  const skip = proof.options.find((o) => o.id === 'skip-proof');
  const others = proof.options.filter((o) => o.id !== 'skip-proof');
  return (
    <section className="rq-card" aria-labelledby="rq-proof-h" data-testid="requirement-proof" data-state={proof.state} data-complete={proof.chain.complete ? 'true' : 'false'}>
      <h2 className="rq-h2" id="rq-proof-h">6. Prove the screen</h2>
      <p className="rq-muted">A generated screen is done when it is shown to work: its four states, its controller and its service, checked with no browser and no model.</p>
      <div className="rq-row">
        <span className={`rq-badge rq-badge--proof-${proof.state}`} data-testid="proof-state" data-state={proof.state}><span aria-hidden="true">{proof.symbol} </span>{proof.stateLabel}</span>
        <span data-testid="proof-headline">{proof.headline}</span>
      </div>
      <p data-testid="proof-chain" data-complete={proof.chain.complete ? 'true' : 'false'}><strong>Chain:</strong> {proof.chain.line}</p>
      {proof.counts && <p className="rq-muted" data-testid="proof-counts">{proof.counts}</p>}
      {proof.running && <p className="rq-muted" role="status" data-testid="proof-running">Running the proof...</p>}
      {proof.runError && <p className="rq-error" role="alert" data-testid="proof-error">{proof.runError}</p>}
      {proof.failures.map((f) => <Failure key={`${f.test}:${f.summary}`} f={f} />)}

      <div className="rq-row" data-testid="proof-actions">
        <Button type="button" disabled={!proof.canRun} onClick={onRun} data-testid="proof-run" aria-describedby={proof.runDisabledReason ? 'rq-proof-why' : undefined}>{proof.runLabel}</Button>
        {skip && (
          <Button type="button" variant="ghost" disabled={skip.disabledReason !== null || proof.skip.open} onClick={onSkipOpen} data-testid="proof-skip" title={skip.why}>{skip.label}</Button>
        )}
        {others.map((o) => (
          <Button key={o.id} type="button" variant="ghost" disabled={o.disabledReason !== null} data-testid={`proof-option-${o.id}`} title={o.why}>{o.label}</Button>
        ))}
      </div>
      {proof.runDisabledReason && <p className="rq-muted" id="rq-proof-why" data-testid="proof-run-reason">{proof.runDisabledReason}</p>}
      {others.length > 0 && (
        <ul className="rq-proof-options" aria-label="What these options will do" data-testid="proof-option-notes">
          {others.map((o) => (
            <li key={o.id} className="rq-muted" data-testid="proof-option-note" data-option={o.id}><strong>{o.label}.</strong> {o.why} {o.disabledReason}</li>
          ))}
        </ul>
      )}

      {proof.skip.open && (
        <form className="rq-skip" data-testid="proof-skip-form" onSubmit={(e) => { e.preventDefault(); onSkipConfirm(); }}>
          <label className="rq-label" htmlFor="rq-skip-reason">Why skip the proof? The reason is recorded and shown in the chain summary.</label>
          <input id="rq-skip-reason" className="rq-text rq-input" type="text" autoComplete="off" maxLength={proof.skip.max + 40} value={proof.skip.draft} disabled={proof.skip.saving} onChange={(e) => onSkipDraft(e.target.value)} data-testid="proof-skip-reason" aria-describedby="rq-skip-hint" aria-invalid={proof.skip.error ? true : undefined} />
          <p className="rq-muted" id="rq-skip-hint">{proof.skip.min} to {proof.skip.max} characters, one line.</p>
          <div className="rq-row">
            <Button type="submit" disabled={proof.skip.saving} data-testid="proof-skip-confirm">{proof.skip.saving ? 'Saving...' : 'Skip the proof'}</Button>
            <Button type="button" variant="ghost" disabled={proof.skip.saving} onClick={onSkipCancel} data-testid="proof-skip-cancel">Cancel</Button>
          </div>
          {proof.skip.error && <p className="rq-error" role="alert" data-testid="proof-skip-error">{proof.skip.error}</p>}
        </form>
      )}
    </section>
  );
}
