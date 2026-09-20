// Pure (DOMAIN-001): moving and inserting rows of a draft. The page-open row and the "needs" notes stay where they
// are, and nothing can be moved or inserted above the page-open row.
import type { DraftStep, StepFields } from '../types.ts';

/** The rows that can move: everything after the page is opened. */
const movable = (s: StepFields): boolean => s.kind === 'state' || s.kind === 'event' || s.kind === 'check-text';

export const canMove = (draft: DraftStep[], key: number, dir: -1 | 1): boolean => {
  const i = draft.findIndex((d) => d.key === key);
  const j = i + dir;
  return i >= 0 && j >= 0 && j < draft.length && movable(draft[i].step) && movable(draft[j].step);
};

export function move(draft: DraftStep[], key: number, dir: -1 | 1): DraftStep[] {
  if (!canMove(draft, key, dir)) return draft;
  const i = draft.findIndex((d) => d.key === key);
  const next = [...draft];
  [next[i], next[i + dir]] = [next[i + dir], next[i]];
  return next;
}

/** Insert after the given row (or at the end), never before the page is opened. */
export function insertStep(draft: DraftStep[], afterKey: number | null, step: StepFields, key: number): DraftStep[] {
  const firstFree = draft.findIndex((d) => d.step.kind === 'goto') + 1;
  const at = afterKey === null ? draft.length : Math.max(firstFree, draft.findIndex((d) => d.key === afterKey) + 1);
  return [...draft.slice(0, at), { key, origin: null, removed: false, step }, ...draft.slice(at)];
}
