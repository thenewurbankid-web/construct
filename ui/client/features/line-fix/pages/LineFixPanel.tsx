import { FixLine } from '../components/FixLine';
import '../components/line-fix.css';
import type { LineFixView } from '../types';

/** One problem's fixes: the recommended one with Apply, the rest under "Other ways to fix", and a refusal sentence
 * when the writer said no. Nothing at all when the problem has no fixes. */
export function LineFixPanel({ view, label }: { view: LineFixView; label: string }) {
  const { options, state, refusal, apply } = view;
  if (!options.recommended) return null;
  const busy = state.phase === 'applying';
  const applying = (id: string) => state.phase === 'applying' && state.fixId === id;
  return (
    <div className="lf" role="group" aria-label={label} data-testid="line-fix">
      <FixLine row={options.recommended} applying={applying(options.recommended.fix.id)} disabled={busy} onApply={apply} />
      {options.others.length > 0 && (
        <details className="lf-more" data-testid="lf-more">
          <summary>Other ways to fix ({options.others.length})</summary>
          <ul className="lf-more-list">
            {options.others.map((row) => (
              <li key={row.fix.id}>
                <FixLine row={row} applying={applying(row.fix.id)} disabled={busy} onApply={apply} />
              </li>
            ))}
          </ul>
        </details>
      )}
      {refusal && (
        <p className="lf-refused" role="alert" data-testid="lf-refused">
          {refusal}
        </p>
      )}
    </div>
  );
}
