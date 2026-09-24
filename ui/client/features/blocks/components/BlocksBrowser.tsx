'use client';

import type { BlocksBrowserProps } from '../types';
import { BlockCard } from './BlockCard';

/** The Browser's Blocks tab: every mechanical block Construct can run, with this project's settings. Presentation only. */
export function BlocksBrowser({ view, onFilter, onToggle, onEngine, onModel, onRun, onRetry, onReset }: BlocksBrowserProps) {
  return (
    <div className="bl-browser" data-testid="blocks-list">
      {view.status === 'loading' && <p className="hint" role="status">Reading the blocks...</p>}
      {view.status === 'failed' && (
        <div role="alert" className="bl-error" data-testid="blocks-error">
          <p>{view.error}</p>
          <button type="button" className="dg-btn" onClick={onRetry} data-testid="blocks-retry">Retry</button>
        </div>
      )}
      {view.status === 'ready' && (
        <>
          <p className="bl-summary" data-testid="blocks-summary">{view.summary}</p>
          {view.unreadable && (
            <div role="alert" className="bl-error" data-testid="blocks-unreadable">
              <p>This project&apos;s block settings could not be read, so every plan is refused until they are reset.</p>
              <button type="button" className="dg-btn" onClick={onReset} data-testid="blocks-reset">Reset block settings</button>
            </div>
          )}
          {view.notice && <p className="bl-refusal" role="alert" data-testid="blocks-notice">{view.notice}</p>}
          <label className="bl-sr" htmlFor="blocks-filter">Filter blocks</label>
          <input id="blocks-filter" className="bl-filter" type="search" placeholder="Filter blocks" value={view.filter} onChange={(e) => onFilter(e.target.value)} data-testid="blocks-filter" />
          {view.empty && <p className="hint" data-testid="blocks-empty">{view.empty}</p>}
          <ul className="bl-cards">
            {view.cards.map((card) => (
              <li key={card.id}>
                <BlockCard card={card} onToggle={onToggle} onEngine={onEngine} onModel={onModel} onRun={onRun} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
