import { applyLabel, canApply } from '../domain/FixOptions';
import type { LineFix } from '../types';

type FixLineProps = { fix: LineFix; applying: boolean; disabled: boolean; onApply: (fix: LineFix) => void };

/** One fix: what it will do in plain English, then Apply; an advice-only fix says what to do by hand, no button. */
export function FixLine({ fix, applying, disabled, onApply }: FixLineProps) {
  const applicable = canApply(fix);
  return (
    <div className="lf-line" data-testid="lf-fix" data-fix={fix.id} data-advice={applicable ? 'false' : 'true'}>
      <p className="lf-sentence">{fix.sentence}</p>
      {applicable ? (
        <button type="button" className="lf-btn" aria-label={applyLabel(fix)} disabled={disabled} onClick={() => onApply(fix)}>
          {applying ? 'Applying...' : 'Apply'}
        </button>
      ) : (
        <span className="lf-hand">Do this by hand</span>
      )}
    </div>
  );
}
