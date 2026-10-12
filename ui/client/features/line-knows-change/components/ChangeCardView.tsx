import { Details, StatusChip } from '@/lib/ChatEntry';
import type { ChangeCard } from '@/lib/lineKnowsContract';

const TONE = { proposed: 'wait', waiting: 'wait', done: 'fit', refused: 'gap' } as const;
const STATE = { proposed: 'Proposed', waiting: 'Waiting for you', done: 'Done', refused: 'Not done' } as const;

/** One proposed change: what it does in plain words, then Plan it, then Approve (the Plan panel's control). */
export function ChangeCardView({ card, busy, onPlan, onApprove, onShow }: { card: ChangeCard; busy: boolean; onPlan: () => void; onApprove: () => void; onShow: () => void }) {
  const name = card.target.replace(/^[a-z]+:/, '').split('/').pop();
  return (
    <li className="ln-card lkc-card" data-testid="knows-change" data-change={card.id} data-kind={card.kind} data-state={card.state}>
      <div className="lkc-top">
        <span className="ln-eyebrow">{card.kindLabel}</span>
        <StatusChip tone={TONE[card.state]} label={STATE[card.state]} testId="knows-change-state" />
      </div>
      <p className="lkc-sentence" data-testid="knows-change-sentence">{card.sentence}</p>
      {card.stateSentence ? <p className="lkc-note" role="status">{card.stateSentence}</p> : null}
      <div className="lkc-actions">
        {card.state === 'proposed' ? (
          <button type="button" className="ln-btn ln-btn--primary" disabled={busy} onClick={onPlan} data-testid="knows-change-plan">
            Plan it
          </button>
        ) : null}
        {card.state === 'waiting' ? (
          <button type="button" className="ln-btn ln-btn--primary" disabled={busy} onClick={onApprove} data-testid="knows-change-approve" data-line-control="plan.approve" data-line-target={card.stepId ?? undefined}>
            Approve
          </button>
        ) : null}
        <button type="button" className="ln-btn ln-btn--ghost" onClick={onShow}>
          Show {name} on the Map
        </button>
      </div>
      <Details lines={card.details} />
    </li>
  );
}
