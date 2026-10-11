import type { FixRow } from '../types';

type FixLineProps = { row: FixRow; applying: boolean; disabled: boolean; onApply: (row: FixRow) => void };

/** One fix: what it will do in plain English, then Apply; an advice-only fix says what to do by hand, no button. */
export function FixLine({ row, applying, disabled, onApply }: FixLineProps) {
  return (
    <div className="lf-line" data-testid="lf-fix" data-fix={row.fix.id} data-advice={row.applicable ? 'false' : 'true'}>
      <p className="lf-sentence">{row.fix.sentence}</p>
      {row.applicable ? (
        <button type="button" className="lf-btn" aria-label={row.label} disabled={disabled} onClick={() => onApply(row)}>
          {applying ? 'Applying...' : 'Apply'}
        </button>
      ) : (
        <span className="lf-hand">Do this by hand</span>
      )}
    </div>
  );
}
