// Pure (DOMAIN-001): the Change tab's cards. A proposal is planned (a plan step waiting for the person), approved and
// run (done), or refused with its one sentence; the item in focus comes first.
import type { PlanStepView } from '@/lib/lineContract';
import type { ChangeCard, ChangeKind, ChangeProposal, ChangeState } from '@/lib/lineKnowsContract';

export const KIND_LABEL: Record<ChangeKind, string> = { rebase: 'Re-base', promote: 'Move to the library', removeCrossUse: 'Remove a cross-feature use' };

/** Where one proposal stands on this page: its plan step id and state, and the sentence to show. */
export type CardProgress = { state: ChangeState; stepId: string | null; sentence: string | null };

/** The cards of the proposals with what the person did on this page. */
export function changeCards(proposals: ChangeProposal[], progress: Record<string, CardProgress>, focus: string | null): ChangeCard[] {
  const cards = proposals.map((p): ChangeCard => {
    const at = progress[p.id] ?? { state: 'proposed' as const, stepId: null, sentence: null };
    return { id: p.id, kind: p.kind, kindLabel: KIND_LABEL[p.kind], sentence: p.sentence, target: p.target, state: at.state, stateSentence: at.sentence, stepId: at.stepId, details: [...p.details, `plan step: ${p.step.tool}`] };
  });
  return focus ? [...cards.filter((c) => c.target === focus), ...cards.filter((c) => c.target !== focus)] : cards;
}

/** The tab's sentence: how many changes wait, and for the item in focus. */
export function changeSentence(proposals: ChangeProposal[], focusName: string | null, serverSentence: string): string {
  if (!proposals.length) return 'Line has no change to propose. Every problem it knew about is fixed.';
  return focusName ? `${serverSentence} Changes for ${focusName} come first.` : serverSentence;
}

/** What one run of a plan step means for its card. */
export function progressAfterRun(step: PlanStepView | undefined, fallback: string): CardProgress {
  if (step && step.state === 'done') return { state: 'done', stepId: step.id, sentence: 'Done: Construct\'s writer saved it and the checks passed.' };
  const why = step?.error ?? step?.sentence ?? fallback;
  return { state: 'refused', stepId: step?.id ?? null, sentence: /[.?!]$/.test(why) ? why : `${why}.` };
}
