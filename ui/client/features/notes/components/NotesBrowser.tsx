import type { NotesBrowserProps } from '../types';
import { StatusTag } from './StatusTag';

/** The Browser's list of this project's notes, newest first, with New note. */
export function NotesBrowser({ rows, status, error, onOpen, onCreate }: NotesBrowserProps) {
  return (
    <div className="nt-browser" data-testid="notes-list">
      <div className="nt-browser-head">
        <button type="button" className="nt-btn nt-btn--primary" data-testid="note-new" onClick={onCreate}>New note</button>
      </div>
      {status === 'loading' && <p className="hint" role="status">Reading your notes...</p>}
      {status === 'failed' && <p className="nt-error" role="alert">{error}</p>}
      {status === 'ready' && rows.length === 0 && <p className="hint" data-testid="notes-list-empty">No notes yet</p>}
      <ul className="nt-rows">
        {rows.map((r) => (
          <li key={r.id}>
            <button type="button" className={`nt-row${r.active ? ' nt-row--active' : ''}`} aria-current={r.active ? 'true' : undefined} data-testid="notes-row" onClick={() => onOpen(r.id)}>
              <span className="nt-row-top">
                <span className="nt-row-title">{r.title}</span>
                <StatusTag tag={r.tag} testId="notes-row-status" />
              </span>
              {r.preview && <span className="nt-row-preview">{r.preview}</span>}
              {r.when && <span className="nt-row-when">{r.when}</span>}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
