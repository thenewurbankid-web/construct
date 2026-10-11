import type { ApplyResult } from '../types';

/** The sentence of the last change that landed, with the files written under Details. Always rendered (empty when
 * there is nothing to say) so screen readers hear it as a live region. */
export function ChangeNotice({ notice }: { notice: ApplyResult | null }) {
  return (
    <div className="ll-notice-slot" role="status" aria-live="polite">
      {notice && (
        <div className="ll-notice" data-testid="ll-notice">
          <p>{notice.sentence}</p>
          <details className="ll-tech">
            <summary>Details</summary>
            {notice.files.map((f) => (
              <code key={f}>{f}</code>
            ))}
          </details>
        </div>
      )}
    </div>
  );
}
