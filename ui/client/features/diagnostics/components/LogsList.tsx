import type { LogsViewProps } from '../types';

/** Recent server and command output, oldest first, newest at the bottom. */
export function LogsList({ rows, error, onRefresh, onClear }: LogsViewProps) {
  return (
    <div className="dg-root">
      <div className="dg-bar">
        <span className="dg-headline">{rows.length ? `${rows.length} recent ${rows.length === 1 ? 'line' : 'lines'}` : 'No logs yet'}</span>
        <span className="sh-spacer" />
        <button type="button" className="dg-btn" onClick={onRefresh}>Refresh</button>
        <button type="button" className="dg-btn" onClick={onClear} disabled={!rows.length}>Clear view</button>
      </div>
      {error && <p className="dg-note" role="alert">{error}</p>}
      {rows.length === 0 && !error ? (
        <div className="dg-empty" data-testid="logs-empty">
          <p className="dg-empty-title">No logs yet</p>
          <p className="hint">Output from commands you run, and from validate, will collect here.</p>
        </div>
      ) : (
        <ol className="dg-log" aria-label="Recent output" data-testid="logs-list">
          {rows.map((r) => (
            <li key={r.id} className={`dg-log-line dg-log-line--${r.level}`}>
              <time className="dg-log-time">{r.time}</time>
              <span className="dg-log-src">{r.source}</span>
              <span className="dg-log-text">{r.text}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
