import type { ReviewSourcesProps } from '../types';

/** Browser pane of the list: where the list comes from, and what it is compared against. */
export function ReviewSources({ sourceLabel, base, baseSha, refs, count, onBase }: ReviewSourcesProps) {
  return (
    <div className="rv-side" data-testid="review-sources">
      <h2 className="rv-side-h">Source</h2>
      <p className="rv-side-row"><span>{sourceLabel}</span> <span className="rv-count" data-testid="review-source-count">{count}</span></p>
      <p className="rv-hint">Reading git in this project only. Nothing here is written to any branch.</p>
      <h2 className="rv-side-h">Compared against</h2>
      <label className="rv-field">
        <span className="rv-sr">Base branch</span>
        <select value={base} onChange={(e) => onBase(e.target.value)} data-testid="review-base">
          {refs.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
      {baseSha && <p className="rv-hint"><code>{baseSha.slice(0, 7)}</code> — each change is measured from where it left this branch.</p>}
    </div>
  );
}
