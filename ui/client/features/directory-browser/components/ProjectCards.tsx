'use client';

import type { ProjectCardView, ProjectCardsProps } from '../types';

function Tag({ tag }: { tag: string | null }) {
  if (!tag) return null;
  return <span className="ln-project-tag">{tag}</span>;
}

function ProjectCard({ card, disabled, onSelect }: { card: ProjectCardView; disabled?: boolean; onSelect: (path: string) => void }) {
  return (
    <li>
      <button type="button" className="ln-project-card" onClick={() => onSelect(card.path)} disabled={disabled} aria-label={`Open ${card.name}`} data-testid="project-card" data-line-control="open-project.card" data-line-target={card.name}>
        <span className="ln-project-name">{card.name}</span>
        <span className="ln-project-meta">
          <span className="ln-chip" data-tone={card.status.tone} data-testid="project-card-status">
            {card.status.label}
          </span>
          <Tag tag={card.tag} />
        </span>
      </button>
    </li>
  );
}

function CardGrid({ cards, disabled, onSelect }: Pick<ProjectCardsProps, 'cards' | 'disabled' | 'onSelect'>) {
  if (!cards?.length) return null;
  const card = (c: ProjectCardView) => <ProjectCard key={c.path} card={c} disabled={disabled} onSelect={onSelect} />;
  return <ul className="ln-projects-grid">{cards.map(card)}</ul>;
}

function Status({ cards, error }: Pick<ProjectCardsProps, 'cards' | 'error'>) {
  if (error) return <p className="ln-q-error" role="alert">{error}</p>;
  if (!cards) return <p className="ln-muted">Loading your projects…</p>;
  return null;
}

function ShowMore({ cards, total, truncated, loading, onLoadMore }: Pick<ProjectCardsProps, 'cards' | 'total' | 'truncated' | 'loading' | 'onLoadMore'>) {
  if (!truncated) return null;
  return (
    <button type="button" className="ln-btn ln-btn--ghost" onClick={onLoadMore} disabled={loading}>
      Show more ({cards?.length ?? 0} of {total})
    </button>
  );
}

/** Presentation-only "Your projects" as cards for the Open-a-project screen: each card is one button (one click opens
 * the project) with the project's name, one status word and a small framework tag when it helps. A semantic list; the
 * cards are real buttons (Tab to move, Enter or Space to open). */
export function ProjectCards(p: ProjectCardsProps) {
  return (
    <section className="ln-projects" aria-label="Your projects" aria-busy={p.loading} data-testid="project-cards">
      <Status cards={p.cards} error={p.error} />
      <CardGrid cards={p.cards} disabled={p.disabled} onSelect={p.onSelect} />
      <ShowMore cards={p.cards} total={p.total} truncated={p.truncated} loading={p.loading} onLoadMore={p.onLoadMore} />
    </section>
  );
}
