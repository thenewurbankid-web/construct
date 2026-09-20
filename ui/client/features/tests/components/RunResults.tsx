import type { RunPanelProps } from '../types';
import { RunFailure } from './RunFailure';

/** The last run, test by test (a symbol AND a word each), then the explanation of every failure, inline. */
export function RunResults({ view, copied, onCopy, onOpenTest }: RunPanelProps) {
  if (view.rows.length === 0) return null;
  return (
    <div data-testid="run-results">
      <ul className="ts-results" aria-label="Result of the last run, test by test">
        {view.rows.map((r) => (
          <li key={r.key} className={`ts-result ts-result--${r.mark.tone}`} data-testid="run-result" data-status={r.mark.status}>
            <span className="ts-result-mark"><span aria-hidden="true">{r.mark.symbol} </span>{r.mark.word}</span>
            <button type="button" className="ts-row-btn ts-result-title" onClick={() => onOpenTest(r.area, r.file)} aria-label={`Open ${r.title}`}><span className="ts-cell-clip">{r.title}</span></button>
            <span className="ts-cell-sub">{r.detail}</span>
          </li>
        ))}
      </ul>
      {view.failures.map((t) => <RunFailure key={`${t.area}/${t.file}/${t.title}`} outcome={t} copied={copied} onCopy={onCopy} />)}
    </div>
  );
}
