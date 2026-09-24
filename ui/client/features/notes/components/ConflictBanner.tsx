import type { ConflictView, EditorHandlers } from '../types';

type Props = { conflict: ConflictView } & Pick<EditorHandlers, 'onKeepMine' | 'onLoadTheirs' | 'onToggleCompare'>;

const LEGEND = { same: 'Both', mine: 'Only yours', theirs: 'Only theirs' } as const;

/** A stale write: two tabs edited the same note. Nothing is overwritten; choose which copy wins, or compare first. */
export function ConflictBanner({ conflict, onKeepMine, onLoadTheirs, onToggleCompare }: Props) {
  return (
    <section className="nt-banner nt-banner--warn" role="alert" aria-labelledby="note-conflict-h" data-testid="note-conflict">
      <h2 className="nt-banner-h" id="note-conflict-h">This note changed in another tab</h2>
      <p>Two tabs edited the same note, so nothing was overwritten. Choose which copy wins.</p>
      <div className="nt-actions">
        <button type="button" className="nt-btn nt-btn--primary" data-testid="note-keep-mine" onClick={onKeepMine}>Keep mine</button>
        <button type="button" className="nt-btn" data-testid="note-load-theirs" onClick={onLoadTheirs}>Load theirs</button>
        <button type="button" className="nt-btn" data-testid="note-compare" aria-expanded={conflict.comparing} onClick={onToggleCompare}>{conflict.comparing ? 'Hide comparison' : 'Compare'}</button>
      </div>
      {conflict.comparing && (
        <div className="nt-compare" data-testid="note-compare-panel">
          {conflict.titleChanged && (
            <p className="nt-compare-title">
              Title: yours <q>{conflict.titleChanged.mine || 'Untitled note'}</q>, theirs <q>{conflict.titleChanged.theirs || 'Untitled note'}</q>
            </p>
          )}
          <ol className="nt-compare-lines" aria-label="Your text against theirs, line by line">
            {conflict.lines.map((l) => (
              <li key={l.key} className={`nt-line nt-line--${l.kind}`} data-kind={l.kind}>
                <span className="nt-line-mark">{l.kind === 'same' ? ' ' : l.kind === 'mine' ? '+' : '-'}</span>
                <span className="nt-line-text">{l.text || ' '}</span>
                <span className="nt-sr"> ({LEGEND[l.kind]})</span>
              </li>
            ))}
          </ol>
          <p className="hint">+ only in your copy, - only in theirs.</p>
        </div>
      )}
    </section>
  );
}
