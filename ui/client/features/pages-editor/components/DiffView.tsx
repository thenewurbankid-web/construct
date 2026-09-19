import type { DiffRow } from '../types';

type DiffViewProps = { rows: DiffRow[] };

// Presentational unified diff with line numbers — the renderer is swappable
// (a Monaco diff adapter can take the same `rows` later). Props only.
export function DiffView({ rows }: DiffViewProps) {
  return (
    <div className="diff-view" role="table" aria-label="Diff of last external change">
      {rows.map((row, i) => {
        if (row.kind === 'gap') {
          return (
            <div key={i} className="diff-view-row diff-view-gap" role="row">
              {'⋯'} {row.text}
            </div>
          );
        }
        const marker = row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : ' ';
        return (
          <div key={i} className={`diff-view-row diff-view-${row.kind}`} role="row" data-kind={row.kind}>
            <span className="diff-view-num">{row.oldLine ?? ''}</span>
            <span className="diff-view-num">{row.newLine ?? ''}</span>
            <span className="diff-view-marker">{marker}</span>
            <span className="diff-view-text">{row.text}</span>
          </div>
        );
      })}
    </div>
  );
}
