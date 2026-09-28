// Pure (DOMAIN-001): the sentence read aloud when a process's state changes.
import type { ProcessSummary, TopState } from '../types.ts';
import { STATE_LABEL } from './StateLabels.ts';

export type SeenStates = Record<string, TopState>;

/** One line per process whose state changed since `seen`, in list order; a process appearing for the
 * first time is not announced (it would fire on every reload of a process that has been running for
 * hours, not only on an actual change). */
export function stateChangeAnnouncements(summaries: ProcessSummary[], seen: SeenStates): string[] {
  return summaries.filter((s) => seen[s.id] !== undefined && seen[s.id] !== s.state).map((s) => `${s.title}: ${STATE_LABEL[s.state]}`);
}

/** The state to remember next time, one entry per process seen so far. */
export function nextSeenStates(summaries: ProcessSummary[], seen: SeenStates): SeenStates {
  const next = { ...seen };
  for (const s of summaries) next[s.id] = s.state;
  return next;
}
