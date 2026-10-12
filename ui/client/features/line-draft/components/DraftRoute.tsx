import { StreamedText } from '@/lib/StreamedText';
import type { RouteCard } from '../types';

type Add = { busy: boolean; onAdd: (routeId: string) => void };

const code = (text: string) => <code key={text}>{text}</code>;

/** A refused route's typed fix, in words; nothing when it has none. */
function Fix({ fix }: { fix: string | null }) {
  if (!fix) return null;
  return <p className="ldr-fix">Suggested fix: {fix}</p>;
}

/** im3 + j5: why Line recommends this route from your past picks; nothing otherwise. */
function Memory({ memory }: { memory: string | null }) {
  if (!memory) return null;
  return (
    <p className="ldr-memory" data-testid="draft-route-memory">
      {memory}
    </p>
  );
}

/** Add to plan, only for a route Construct checked. */
function AddButton({ card, busy, onAdd }: Add & { card: RouteCard }) {
  if (!card.canAdd) return null;
  return (
    <span className="ldr-actions">
      <button type="button" className={card.recommended ? 'ldr-btn ldr-btn--primary' : 'ldr-btn'} onClick={() => onAdd(card.id)} disabled={busy} aria-label={`Add to plan: ${card.label}`}>
        Add to plan
      </button>
    </span>
  );
}

/** One route: what it does and what Construct found first; Add to plan for a checked route; the steps under Details. */
export function DraftRoute({ card, ...add }: Add & { card: RouteCard }) {
  return (
    <li className="ldr-route" data-testid="draft-route" data-route={card.id} data-status={card.status} data-recommended={String(card.recommended)}>
      <span className="ldr-state" data-status={card.status}>
        {card.statusLabel}
      </span>
      <p className="ldr-label" data-testid="draft-route-label">
        {card.label}
      </p>
      <StreamedText text={card.sentence} className="ldr-sentence" testId="draft-route-sentence" />
      <Memory memory={card.memory} />
      <Fix fix={card.fix} />
      <p className="ldr-risk">{card.risk}</p>
      <AddButton card={card} {...add} />
      <details className="ldr-tech">
        <summary>Details</summary>
        <span>{card.how}</span>
        {card.calls.map(code)}
      </details>
    </li>
  );
}
