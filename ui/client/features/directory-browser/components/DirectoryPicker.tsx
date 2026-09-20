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

/** Presentational, swappable folder picker: renders whatever listing it is
 * given and reports intent through callbacks — no fetching, no state beyond
 * what the props carry. Keyboard: every action is a real <button>/checkbox
 * (Tab to move, Enter/Space to activate); rows are a semantic list. */
export function DirectoryPicker({
  listing,
  loading,
  error,
  showHidden,
  onNavigate,
  onUp,
  onSelect,
  onToggleHidden,
  onLoadMore,
}: DirectoryPickerProps) {
  return (
    <section className="dir-picker" aria-label="Choose a project folder" aria-busy={loading}>
      {error && <p className="status-error" role="alert">{error}</p>}
      {!listing && !error && <p className="hint">Loading folders…</p>}
      {listing && (
        <>
          {listing.crumbs.length > 0 && (
            <nav className="dir-picker__crumbs" aria-label="Location in the workspace" data-testid="dir-picker-crumbs">
              <ol>
                {listing.crumbs.map((crumb, i) => {
                  const last = i === listing.crumbs.length - 1;
                  return (
                    <li key={crumb.path}>
                      {last ? (
                        <span aria-current="page">{crumb.label}</span>
                      ) : (
                        <button type="button" className="dir-picker__crumb" onClick={() => onNavigate(crumb.path)} disabled={loading}>
                          {crumb.label}
                        </button>
                      )}
                    </li>
                  );
                })}
              </ol>
            </nav>
          )}
          <div className="dir-picker__current">
            <code data-testid="dir-picker-path">{listing.path}</code>
            <Badges badges={listing.currentBadges} />
          </div>
          <div className="dir-picker__actions">
            <Button type="button" variant="ghost" onClick={onUp} disabled={!listing.parent || loading}>Up one level</Button>
            <Button type="button" onClick={() => onSelect(listing.path)}>Use this folder</Button>
            <label className="dir-picker__hidden">
              <input type="checkbox" checked={showHidden} onChange={(e) => onToggleHidden(e.target.checked)} /> Show hidden folders
            </label>
          </div>
          {listing.entries.length === 0 ? (
            <p className="hint">No sub-folders here.</p>
          ) : (
            <ul className="dir-picker__list">
              {listing.entries.map((entry) => (
                <li key={entry.path} className="dir-picker__row">
                  <button type="button" className="dir-picker__open" onClick={() => onNavigate(entry.path)} aria-label={`Open ${entry.name}`}>
                    {entry.name}
                  </button>
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
