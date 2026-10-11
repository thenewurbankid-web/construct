import type { LibraryGroup } from '../types';

/** The library's components as cards, one section per level (Atoms, Molecules, Organisms). Each card: name,
 * level and how many feature components are based on it; the file path is under a collapsed Details. */
export function LibraryCards({ groups }: { groups: LibraryGroup[] }) {
  return (
    <>
      {groups.map((g) => (
        <section key={g.level} className="ll-group" aria-labelledby={`ll-level-${g.level}`} data-testid={`ll-group-${g.level}`}>
          <h2 id={`ll-level-${g.level}`} className="ll-level-head">
            {g.title} <small>{g.hint}</small>
          </h2>
          <ul className="ll-grid" aria-label={g.title}>
            {g.cards.map((c) => (
              <li key={c.id} className="ll-card" data-testid="ll-card" data-level={c.level}>
                <span className="ll-card-title">{c.name}</span>
                <span className="ll-row">
                  <span className="ll-chip">{c.levelLabel}</span>
                  <span className={c.usedByCount ? 'll-chip ll-chip--accent' : 'll-chip'} data-testid="ll-used-by">
                    {c.usedByText}
                  </span>
                </span>
                <details className="ll-tech">
                  <summary>Details</summary>
                  <code>{c.file}</code>
                </details>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
