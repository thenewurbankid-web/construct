import { useEffect, useRef } from 'react';
import type { UnitSummariesProps } from '../types';

/** Stage of one change: what each changed unit now does, read from the code on the head commit. */
export function UnitSummaries({ rows, more, selectedPath, onSelect }: UnitSummariesProps) {
  const selectedRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    selectedRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedPath]);
  return (
    <section className="rv-units" aria-label="What each changed unit now does" data-testid="review-units">
      <header className="rv-units-head">
        <h2 className="rv-side-h">What this change actually does</h2>
        <span className="rv-hint">read from the code, not from the description <span className="rv-det">DETERMINISTIC</span></span>
      </header>
      <ul className="rv-unit-list">
        {rows.map((r) => {
          const selected = r.path === selectedPath;
          return (
            <li key={r.path} ref={selected ? selectedRef : undefined} className="rv-unit" aria-current={selected ? 'true' : undefined} data-testid="review-unit" data-path={r.path}>
              <button type="button" className="rv-unit-btn" onClick={() => onSelect(r.path)}>
                <span className="rv-chip">{r.layer}</span>
                <span className="rv-unit-name">{r.name}</span>
                <span className="rv-feature-tag">{r.feature}</span>
                <span className={`rv-status rv-status--${r.isNew ? 'A' : 'M'}`}>{r.isNew ? 'new' : 'modified'}</span>
              </button>
              <p className="rv-unit-text" data-testid="review-unit-summary">{r.text}</p>
            </li>
          );
        })}
        {more && (
          <li className="rv-unit rv-unit--more" data-testid="review-units-more">
            <span className="rv-chip">+{more.count} more</span> {more.text}
          </li>
        )}
      </ul>
    </section>
  );
}
