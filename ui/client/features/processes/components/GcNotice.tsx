import type { GcDetailLine } from '../types';

/** #416 -- "N item(s) can be cleaned up" with a Details link, above the process list. Presentation-only: every
 * value and handler comes from the controller (`gcCleanupCount`/`gcDetailLines`, domain/GcCounts.ts). Nothing
 * here deletes anything -- run `construct process gc` (without `--dry-run`) for that. */
export function GcNotice({ count, details, onToggle }: { count: number; details: GcDetailLine[] | null; onToggle: () => void }) {
  if (count === 0) return null;
  return (
    <div className="dg-note pr-gc" role="status" data-testid="processes-gc-notice">
      <span>{count} item{count === 1 ? '' : 's'} from earlier sessions could be cleaned up.</span>{' '}
      <button type="button" className="pr-gc-link" data-testid="processes-gc-toggle" onClick={onToggle}>
        {details ? 'Hide' : 'Details'}
      </button>
      {details && (
        <ul className="pr-gc-details" data-testid="processes-gc-details">
          {details.map((d) => <li key={d.key}>{d.text}</li>)}
          <li className="hint">Run <code>construct process gc</code> to remove these (or <code>--dry-run</code> to preview again).</li>
        </ul>
      )}
    </div>
  );
}
