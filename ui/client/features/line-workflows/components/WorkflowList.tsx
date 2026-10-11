import type { WorkflowCard } from '../types';

type WorkflowListProps = { feature: string; cards: WorkflowCard[]; current: string | null; onChoose: (id: string) => void };

/** The feature's workflows: each with its base and how many of its pages are chosen. */
export function WorkflowList({ feature, cards, current, onChoose }: WorkflowListProps) {
  if (!cards.length) return <p className="hint" data-testid="lw-empty">{feature} has no workflows yet. Start one from a library workflow below.</p>;
  const item = (c: WorkflowCard) => (
    <li key={c.id}>
      <button type="button" className="lw-item" aria-pressed={c.id === current} onClick={() => onChoose(c.id)} data-testid="lw-workflow" data-workflow={c.name}>
        <span className="lw-item-name">{c.name}</span>
        <span className="lw-muted">{c.base}</span>
        <span className={c.ok ? 'lw-chip lw-chip--ok' : 'lw-chip lw-chip--todo'}>{c.pages}</span>
      </button>
    </li>
  );
  return (
    <ul className="lw-list" aria-label={`Workflows of ${feature}`}>
      {cards.map(item)}
    </ul>
  );
}
