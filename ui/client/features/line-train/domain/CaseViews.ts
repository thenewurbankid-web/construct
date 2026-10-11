import type { CaseView, TrainCaseView } from '../types';
import { caseCards } from './RouteCards.ts';

const BY = { claude: 'Proposed by Claude', owner: 'Labelled by you' } as const;

/** What a case card says about its review: nothing to say while Claude's case waits for the owner. */
function statusLine(c: TrainCaseView): string {
  if (c.status === 'agreed') return c.labelledBy === 'owner' ? 'Saved by you.' : 'You agreed.';
  if (c.status === 'disputed') return `You disagreed: ${c.notes.filter((n) => n.by === 'owner').at(-1)?.text ?? 'no note.'}`;
  return '';
}

/** A stored case as its card shows it. */
export function caseView(c: TrainCaseView): CaseView {
  return {
    id: c.id, by: BY[c.labelledBy], request: c.filled.request, intent: c.filled.intentPhrase, world: c.filled.world,
    status: c.status, statusLine: statusLine(c), canReview: c.labelledBy === 'claude' && c.status === 'draft',
    cards: caseCards(c.filled.routes), slotted: c.request, intentId: c.intent, split: c.split === 'heldout' ? 'held out for eval' : 'used for training',
    problem: c.filled.sentence ?? '',
  };
}
