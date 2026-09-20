// Pure (DOMAIN-001): the draft of a step document being edited: its rows, what changed since it was opened, and the
// list the server is asked to validate. No I/O.
import type { DraftStep, StepChange, StepFields } from '../types.ts';

export const draftOf = (steps: StepFields[]): DraftStep[] => steps.map((step, i) => ({ key: i, origin: i, removed: false, step }));

/** Only the rows that stay, in order: what is sent to the server. `sentence` / `keyword` / `binding` never travel. */
export function payloadOf(draft: DraftStep[]): StepFields[] {
  return draft.filter((d) => !d.removed).map((d) => d.step);
}

const same = (a: StepFields, b: StepFields | undefined): boolean => JSON.stringify(a) === JSON.stringify(b);

export function changeOf(d: DraftStep, original: StepFields[]): StepChange {
  if (d.origin === null) return d.removed ? null : 'added';
  if (d.removed) return 'removed';
  return same(d.step, original[d.origin]) ? null : 'changed';
}
