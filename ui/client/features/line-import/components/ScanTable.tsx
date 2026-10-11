import type { ImportViewModel } from '../types';
import { FoundItem } from './FoundItem';
import { TechDetails } from './TechDetails';

/** Step 2: what Line found and proposes, grouped by where it goes, in plain English; file paths and rules under Details. */
export function ScanTable({ view }: { view: ImportViewModel }) {
  return (
    <section className="li-card" aria-labelledby="li-found-h">
      <h2 id="li-found-h" className="li-h2">What Line proposes</h2>
      {view.groups.map((g) => (
        <div key={g.key} className="li-group" data-testid="li-group">
          <h3 className="li-h3">{g.title}</h3>
          <ul className="li-list">
            {g.rows.map((row) => <FoundItem key={row.file} row={row} />)}
          </ul>
        </div>
      ))}
      <TechDetails summary="Files that stay as they are" lines={view.unchanged} testId="li-unchanged" />
      <TechDetails summary="Routes Line read" lines={view.routes} />
    </section>
  );
}
