import type { ChangeControls, LibraryCard, LibraryGroup } from '../types';
import { BaseOnForm } from './BaseOnForm';
import { CardPreview } from './CardPreview';
import { ReadOnlyTag } from './ReadOnlyTag';

function Card({ card, controls }: { card: LibraryCard; controls: ChangeControls }) {
  const open = (controls.change.status === 'base-on' || controls.change.status === 'base-on-saving') && controls.change.libraryId === card.id;
  return (
    <li className="ll-card" data-testid="ll-card" data-level={card.level}>
      <span className="ll-card-title">{card.name}</span>
      <span className="ll-row">
        <span className="ll-chip">{card.levelLabel}</span>
        <span className={card.usedByCount ? 'll-chip ll-chip--accent' : 'll-chip'} data-testid="ll-used-by">
          {card.usedByText}
        </span>
        <ReadOnlyTag show={card.readOnly} />
      </span>
      {open ? (
        <BaseOnForm controls={controls} libraryName={card.name} />
      ) : (
        <button type="button" className="ll-btn" aria-label={`Base on this: ${card.name}`} data-line-control="components.baseOn" data-line-target={card.name} onClick={() => controls.openBaseOn(card.id, card.name)} disabled={!controls.features.length}>
          Base on this
        </button>
      )}
      <CardPreview card={card} />
      <details className="ll-tech">
        <summary>Details</summary>
        <code>{card.file}</code>
      </details>
    </li>
  );
}

/** The library's components as cards, one section per level (Atoms, Molecules, Organisms). Each card: name,
 * level, how many feature components are based on it, "Base on this", a Preview of the component rendered alone,
 * and the file path under Details. */
export function LibraryCards({ groups, controls }: { groups: LibraryGroup[]; controls: ChangeControls }) {
  return (
    <>
      {groups.map((g) => (
        <section key={g.level} className="ll-group" aria-labelledby={`ll-level-${g.level}`} data-testid={`ll-group-${g.level}`}>
          <h2 id={`ll-level-${g.level}`} className="ll-level-head">
            {g.title} <small>{g.hint}</small>
          </h2>
          <ul className="ll-grid" aria-label={g.title}>
            {g.cards.map((c) => (
              <Card key={c.id} card={c} controls={controls} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
