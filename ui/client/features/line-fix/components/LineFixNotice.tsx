import type { ApplyResult } from '../types';
import './line-fix.css';

/** The sentence of the last fix ("Saved. ..." or "Nothing was saved: ..."), the files written under a collapsed
 * Details. Always rendered (empty when there is nothing to say) so screen readers hear it as a live region; it
 * belongs to the screen, so it stays after the fixed problem leaves the list. */
export function LineFixNotice({ result }: { result: ApplyResult | null }) {
  return (
    <div className="lf-notice-slot" role="status" aria-live="polite">
      {result && (
        <div className={result.ok ? 'lf-notice' : 'lf-notice lf-notice--refused'} data-testid="lf-notice">
          <p>{result.sentence}</p>
          {result.files.length > 0 && (
            <details className="lf-details">
              <summary>Details</summary>
              {result.files.map((f) => (
                <code key={f}>{f}</code>
              ))}
            </details>
          )}
        </div>
      )}
    </div>
  );
}
