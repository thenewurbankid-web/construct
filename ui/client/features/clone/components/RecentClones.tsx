'use client';

import { Button } from '@/components/ui';

/** One recent clone as the list draws it. */
export type RecentCloneRow = {
  id: string;
  name: string;
  url: string;
  when: string;
  isPrivate: boolean;
  pulling: boolean;
  /** What the last "Pull latest" said, and whether it worked. */
  pullMessage: string | null;
  pullOk: boolean;
};

type RecentClonesProps = {
  rows: RecentCloneRow[];
  onOpen: (id: string) => void;
  onPull: (id: string) => void;
  onForget: (id: string) => void;
};

/** Presentation-only list of the clones this browser made, with Open and Pull latest (#330). Renders nothing when
 * there are none. */
export function RecentClones({ rows, onOpen, onPull, onForget }: RecentClonesProps) {
  if (rows.length === 0) return null;
  return (
    <section className="clone-recent" aria-labelledby="clone-recent-heading" data-testid="clone-recent">
      <h3 id="clone-recent-heading" className="clone-recent__title">Recent clones</h3>
      <p className="hint">On this browser. Pull latest brings a copy up to date without changing your own work; for a private repository fill in the access token above first.</p>
      <ul className="clone-recent__list">
        {rows.map((r) => (
          <li key={r.id} className="clone-recent__item" data-testid="clone-recent-row">
            <div className="clone-recent__head">
              <strong>{r.name}</strong>
              <span className="hint">{r.isPrivate ? 'private · ' : ''}{r.when}</span>
            </div>
            <code className="clone-recent__url">{r.url}</code>
            <div className="clone__actions">
              <Button type="button" onClick={() => onOpen(r.id)} data-testid="clone-recent-open" aria-label={`Open ${r.name}`}>
                Open
              </Button>
              <Button type="button" onClick={() => onPull(r.id)} disabled={r.pulling} data-testid="clone-recent-pull" aria-label={`Pull latest for ${r.name}`}>
                {r.pulling ? 'Pulling…' : 'Pull latest'}
              </Button>
              <Button type="button" onClick={() => onForget(r.id)} data-testid="clone-recent-forget" aria-label={`Remove ${r.name} from this list`}>
                Remove from list
              </Button>
            </div>
            {r.pullMessage && (
              <p className={r.pullOk ? 'hint' : 'status-error'} role={r.pullOk ? 'status' : 'alert'} data-testid="clone-recent-result">
                {r.pullMessage}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
