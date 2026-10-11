import type { ItemGroup } from '../types';
import { ItemRowView } from './ItemRowView';

/** The feature's items by kind (Pages, Components, Workflows, Fixtures). */
export function ItemGroupList({ groups }: { groups: ItemGroup[] }) {
  if (groups.length === 0) return <p className="hint">This feature has nothing in it yet.</p>;
  return (
    <div className="lf-groups">
      {groups.map((g) => (
        <section key={g.kind} aria-labelledby={`lf-group-${g.kind}`} data-testid="lf-group" data-kind={g.kind}>
          <h3 id={`lf-group-${g.kind}`}>{g.title}</h3>
          <ul className="lf-items" aria-label={g.title}>
            {g.rows.map((row) => (
              <ItemRowView key={row.id} row={row} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
