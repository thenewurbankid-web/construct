'use client';

import { Button } from '@/components/ui';
import type { DirBadge, DirectoryPickerProps } from '../types';

function Badges({ badges }: { badges: DirBadge[] }) {
  return (
    <>
      {badges.map((b) => (
        <span key={b.key} className={`dir-badge dir-badge--${b.key}`}>{b.label}</span>
      ))}
    </>
  );
}

/** Presentational, swappable "Your projects" list (#568): one flat level of the signed-in user's own
 * workspace, nothing to navigate into, no path to type. It renders whatever listing it is given and reports
 * the choice through `onSelect` — no fetching, no state beyond what the props carry. Every action is a real
 * <button> (Tab to move, Enter/Space to activate); rows are a semantic list. */
export function DirectoryPicker({ listing, loading, error, onSelect, onLoadMore }: DirectoryPickerProps) {
  return (
    <section className="dir-picker" aria-label="Your projects" aria-busy={loading}>
      {error && <p className="status-error" role="alert">{error}</p>}
      {!listing && !error && <p className="hint">Loading your projects…</p>}
      {listing && (
        <>
          {listing.entries.length === 0 ? (
            <p className="hint">No projects yet. Clone one from GitHub or create a new one below.</p>
          ) : (
            <ul className="dir-picker__list">
              {listing.entries.map((entry) => (
                <li key={entry.path} className="dir-picker__row">
                  <span className="dir-picker__name">{entry.name}</span>
                  <Badges badges={entry.badges} />
                  <Button type="button" variant="ghost" onClick={() => onSelect(entry.path)} aria-label={`Select ${entry.name}`}>Select</Button>
                </li>
              ))}
            </ul>
          )}
          {listing.truncated && (
            <Button type="button" variant="ghost" onClick={onLoadMore} disabled={loading}>
              Load more ({listing.entries.length} of {listing.total})
            </Button>
          )}
        </>
      )}
    </section>
  );
}
