import type { LineWorkflow, WhenDoDraft } from '../types';

/** An empty When -> Do form, starting from the workflow's first state. */
export const emptyDraft = (w: LineWorkflow | null): WhenDoDraft => ({ from: w?.initial ?? w?.states[0]?.id ?? '', event: '', to: w?.states[0]?.id ?? '', service: '', part: '', partState: '' });

/** Why the When -> Do form cannot be added yet, or null when it can. */
export function draftProblem(d: WhenDoDraft): string | null {
  if (!d.event.trim()) return 'Type the event the page sends, such as CANCEL.';
  if (!!d.part.trim() !== !!d.partState.trim()) return 'Name both the part and the state to set it to, or leave both empty.';
  return null;
}
