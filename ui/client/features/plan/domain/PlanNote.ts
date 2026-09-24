// Pure (DOMAIN-001): how a durable note (#609) becomes the Plan screen's state and back. The server owns every rule
// about a note (the rev, "ran", what makes a plan out of date); these only translate shapes and say what "unsaved" means.
import type { Note } from '@/features/notes';
import type { PlanDoc, PlanNote, PlanStep, ScreenState } from './PlanTypes.ts';
import { buildPlan } from './PlanDocument.ts';

export const noteMeta = (n: Note): PlanNote => ({ id: n.id, rev: n.rev, status: n.status, planStale: n.planStale === true, processId: n.processId });

/** The steps a saved plan holds; anything that is not a list of steps reads as no plan. */
export const stepsOf = (plan: unknown): PlanStep[] => {
  const steps = (plan as { steps?: unknown } | null)?.steps;
  return Array.isArray(steps) ? (steps as PlanStep[]) : [];
};

/** The id counter that never collides with the ids a loaded plan already uses (`s1`, `s2`...). */
export const counterAfter = (steps: PlanStep[]): number =>
  steps.reduce((max, s) => {
    const m = /^s(\d+)$/.exec(s.id);
    return m ? Math.max(max, Number(m[1]) + 1) : max;
  }, 1);

/** The ticket and steps a note puts on screen. */
export const screenFromNote = (n: Note): Pick<ScreenState, 'ticket' | 'steps' | 'nextId'> => {
  const steps = stepsOf(n.plan);
  return { ticket: { title: n.title, body: n.body }, steps, nextId: counterAfter(steps) };
};

/** What the server holds, in the two keys autosave compares against the screen. */
export type SavedKeys = { text: string; steps: string };
export const textKey = (ticket: { title: string; body: string }): string => JSON.stringify([ticket.title, ticket.body]);
export const stepsKey = (steps: PlanStep[]): string => JSON.stringify(steps);
export const keysOfNote = (n: Note): SavedKeys => ({ text: textKey({ title: n.title, body: n.body }), steps: stepsKey(stepsOf(n.plan)) });

/** Unsaved: the screen holds text or steps the server copy does not. With no note yet, anything typed counts. */
export const isUnsaved = (s: Pick<ScreenState, 'ticket' | 'steps'>, saved: SavedKeys | null): boolean => {
  if (saved === null) return s.ticket.title !== '' || s.ticket.body !== '' || s.steps.length > 0;
  return saved.text !== textKey(s.ticket) || saved.steps !== stepsKey(s.steps);
};

/** What a save sends beyond the text: the plan (and its status) only when the steps changed, or when asked to keep it. */
export const planPart = (s: Pick<ScreenState, 'ticket' | 'steps'>, saved: SavedKeys | null, force: boolean): { plan?: PlanDoc | null; status?: 'draft' | 'plan-ready' } => {
  if (!force && saved !== null && saved.steps === stepsKey(s.steps)) return {};
  return s.steps.length ? { plan: buildPlan(s.ticket, s.steps), status: 'plan-ready' } : { plan: null, status: 'draft' };
};
