import type { GlossaryEntry } from '../types';
import { HealthBadge } from './HealthBadge';

/** Tools pane of the list: "What the badges mean", one card per badge, in plain language. */
export function BadgeLegend({ entries }: { entries: GlossaryEntry[] }) {
  return (
    <div className="rv-legend" data-testid="review-legend">
      {entries.map((g) => (
        <section key={g.id} className="rv-card">
          <HealthBadge text={g.badge} tone={g.tone} />
          <p className="rv-card-means">{g.means}</p>
          <p className="rv-hint">{g.from}</p>
        </section>
      ))}
    </div>
  );
}
