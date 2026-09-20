import type { KeyboardEvent } from 'react';
import type { BranchListProps } from '../types';
import { HealthBadge } from './HealthBadge';

/** Arrow keys move between rows; Enter (the button's own behaviour) opens one. */
function moveFocus(e: KeyboardEvent<HTMLUListElement>) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
  const rows = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button.rv-row'));
  const at = rows.indexOf(document.activeElement as HTMLButtonElement);
  if (at < 0) return;
  e.preventDefault();
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? rows.length - 1 : Math.max(0, Math.min(rows.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)));
  rows[next]?.focus();
}

/** The stage of Review mode: every branch, ranked by what Construct found. */
export function BranchList({ base, rows, order, explanation, onOrder, onOpen, onReload }: BranchListProps) {
  return (
    <div className="rv-stage" data-testid="review-list">
      <header className="rv-toolbar">
        <h1 className="rv-h1">Changes <span className="rv-crumb">compared against <code>{base}</code></span></h1>
        <div className="rv-toggle" role="group" aria-label="Order">
          <button type="button" aria-pressed={order === 'risk'} onClick={() => onOrder('risk')}>Riskiest first</button>
          <button type="button" aria-pressed={order === 'newest'} onClick={() => onOrder('newest')}>Newest</button>
        </div>
        <button type="button" className="dg-btn" onClick={onReload} data-testid="review-reanalyse">Re-analyse all</button>
      </header>
      <p className="rv-lede">
        Every badge is computed from your <code>architecture.yml</code> and the two commits, not from the diff text and not by a model.{' '}
        <span className="rv-det">DETERMINISTIC</span>
      </p>
      <p className="rv-hint" data-testid="review-order-note">{explanation}</p>
      {rows.length === 0 ? (
        <div className="dg-empty" data-testid="review-empty">
          <p className="dg-empty-title">No other branches to review</p>
          <p className="hint">Create a branch and commit to it, and it will appear here compared against <code>{base}</code>.</p>
        </div>
      ) : (
        <ul className="rv-list" aria-label="Branches" onKeyDown={moveFocus}>
          {rows.map((r) => (
            <li key={r.name}>
              <button type="button" className="rv-row" data-testid="review-row" data-branch={r.name} onClick={() => onOpen(r.name)}>
                <span className="rv-row-main">
                  <span className="rv-row-title" title={r.subject}>{r.subject || r.name}</span>
                  <span className="rv-row-meta"><code className="rv-branch" title={r.name}>{r.name}</code> {r.meta}</span>
                </span>
                <span className="rv-badges">
                  {r.badges?.map((b) => <HealthBadge key={b.id} text={b.text} tone={b.tone} />)}
                  {r.pending && <span className="rv-pending" role="status" data-testid="review-analysing">{r.pending}</span>}
                  {r.stopped && <span className="rv-stopped" data-testid="review-cancelled" title="This analysis was cancelled. Re-analyse all runs it again.">{r.stopped}</span>}
                  {r.error && <span className="rv-badge rv-badge--warn" title={r.error}>Analysis failed</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
