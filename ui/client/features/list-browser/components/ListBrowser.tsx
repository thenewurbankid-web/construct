'use client';

import { useState } from 'react';
import { EmptyState, ErrorState, LoadingState } from '@/features/states';
import { countText, filterItems } from '../domain/ListFilter';
import { tabStopIndex } from '../domain/ListNav';
import { useListKeys } from '../hooks/useListKeys';
import type { ListBrowserProps } from '../types';
import './list-browser.css';

/** A Browser-pane list: a filter box and an ARIA listbox (one tab stop; Up/Down/Home/End move, Enter selects), with the
 * designed loading / error / empty states, each ending in its one next action. Presentation plus local filter text. */
export function ListBrowser({ label, filterLabel, items, selectedId, onSelect, status, error, onRetry, emptyTitle, emptyHint, emptyAction, testId, header }: ListBrowserProps) {
  const [query, setQuery] = useState('');
  const keys = useListKeys(onSelect);
  const shown = filterItems(items, query);
  const tabStop = tabStopIndex(shown.map((i) => i.id), selectedId);

  if (status === 'loading') return <div className="lb" data-testid={testId}>{header}<LoadingState size="inline" label={`Loading ${label.toLowerCase()}`} /></div>;
  if (status === 'error') {
    return (
      <div className="lb" data-testid={testId}>
        {header}
        <ErrorState size="inline" title={`Could not load the ${label.toLowerCase()}`} hint={error} onRetry={onRetry} />
      </div>
    );
  }
  if (items.length === 0) return <div className="lb" data-testid={testId}>{header}<EmptyState size="inline" title={emptyTitle} hint={emptyHint} actions={emptyAction ? [emptyAction] : []} /></div>;

  return (
    <div className="lb" data-testid={testId}>
      {header}
      <input
        ref={keys.filterRef}
        className="lb-filter"
        type="search"
        aria-label={filterLabel}
        placeholder={filterLabel}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={keys.onFilterKeyDown}
        data-testid={`${testId}-filter`}
      />
      <p className="lb-count" role="status" data-testid={`${testId}-count`}>{countText(shown.length, items.length, query)}</p>
      {shown.length === 0 ? (
        <EmptyState size="inline" title={`Nothing matches “${query.trim()}”`} hint="Try fewer or different words." actions={[{ label: 'Clear the filter', onClick: () => { setQuery(''); keys.filterRef.current?.focus(); }, primary: true }]} />
      ) : (
        <ul ref={keys.listRef} className="lb-list" role="listbox" aria-label={label}>
          {shown.map((item, i) => (
            <li
              key={item.id}
              role="option"
              aria-selected={item.id === selectedId}
              tabIndex={i === tabStop ? 0 : -1}
              className="lb-row"
              data-list-row
              data-id={item.id}
              data-testid={`${testId}-item`}
              onClick={() => onSelect(item.id)}
              onKeyDown={keys.onRowKeyDown}
            >
              <span className="lb-label">{item.label}</span>
              {item.detail && <span className="lb-detail">{item.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
