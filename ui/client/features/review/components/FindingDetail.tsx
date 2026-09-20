import type { FindingDetailProps } from '../types';

/** Stage: the selected finding. A mechanical one shows the exact command (never run from here); a conversation shows the question. */
export function FindingDetail({ detail, onClose }: FindingDetailProps) {
  return (
    <section className={`rv-detail rv-detail--${detail.resolution}`} data-testid="review-finding-detail" data-kind={detail.resolution} aria-label="Selected finding">
      <header className="rv-detail-head">
        <span className={`rv-badge ${detail.resolution === 'mechanical' ? 'rv-badge--ok' : 'rv-badge--info'}`}>
          <span aria-hidden="true">{detail.resolution === 'mechanical' ? '✓ ' : '◆ '}</span>{detail.resolutionLabel}
        </span>
        <button type="button" className="dg-btn" onClick={onClose} data-testid="review-finding-close">Close</button>
      </header>
      <h2 className="rv-detail-title">{detail.title}</h2>
      {detail.location && <p className="rv-hint"><code>{detail.location}</code></p>}
      <p>{detail.message}</p>
      {detail.rule && <p className="rv-hint">Rule <code>{detail.rule}</code>{detail.why ? `: ${detail.why}` : ''}</p>}
      {detail.constraint && <p className="rv-hint">{detail.constraint}</p>}
      {detail.fix ? (
        <div className="rv-fixbox" data-testid="review-detail-fix" data-available={detail.fix.available ? 'yes' : 'no'}>
          <p className="rv-fixbox-h">{detail.fix.available ? 'The command that would make this change' : 'No automated fix yet'}</p>
          {detail.fix.command && <pre className="rv-cmd"><code data-testid="review-fix-command">{detail.fix.command}</code></pre>}
          <p className="rv-hint">{detail.fix.text}</p>
          <p className="rv-hint"><strong>Not applied.</strong> Reviewing is read-only: this page never runs the command.</p>
        </div>
      ) : (
        <div className="rv-fixbox rv-fixbox--talk" data-testid="review-detail-conversation">
          <p className="rv-fixbox-h">This is a conversation</p>
          <p className="rv-hint">There is no mechanical fix. It changes what the code means, so it is a question for the author.</p>
        </div>
      )}
    </section>
  );
}
