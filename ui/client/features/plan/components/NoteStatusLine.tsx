import type { NoteStatusHandlers, NoteStatusView } from '../types';

/** One line about the durable note: whether it is saved, and the choice a person has when it is not. */
export function NoteStatusLine({ status, onRetry, onLoadTheirs, onKeepMine, onKeepPlan }: { status: NoteStatusView } & NoteStatusHandlers) {
  const alert = status.kind === 'failed' || status.kind === 'conflict';
  return (
    <div className="pl-note-status" data-testid="plan-note-status" data-kind={status.kind}>
      <p className={alert ? 'pl-err' : 'pl-hint'} role={alert ? 'alert' : 'status'} data-testid="plan-note-saved">{status.label}</p>
      {status.canRetry && <button type="button" className="dg-btn" onClick={onRetry} data-testid="plan-note-retry">Retry</button>}
      {status.canResolve && (
        <>
          <button type="button" className="dg-btn" onClick={onKeepMine} data-testid="plan-note-keep-mine">Keep mine</button>{' '}
          <button type="button" className="dg-btn" onClick={onLoadTheirs} data-testid="plan-note-load-theirs">Load theirs</button>
        </>
      )}
      {status.planStale && (
        <p className="pl-hint" data-testid="plan-note-stale">
          <span className="pl-badge">Plan out of date</span> The note text changed after this plan was saved.{' '}
          <button type="button" className="dg-btn" onClick={onKeepPlan} data-testid="plan-note-keep-plan">Keep this plan</button>
        </p>
      )}
    </div>
  );
}
