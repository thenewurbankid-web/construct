// Pure (DOMAIN-001): the words the Tests screen uses for a clone's freshness (#306). The verdict itself, and every
// sentence about what changed, comes from Construct's core; this only chooses labels.
import type { StaleOverview, TestsListing, YourTest } from '../types.ts';

/** The tag beside a clone in the tree: a word, never only a colour. */
export const cloneTag = (y: YourTest): string => (y.kind !== 'clone' ? 'yours' : y.freshness?.stale ? 'clone · out of date' : 'clone');

/** Clones whose flow changed under them, and the sentence that says so; null when none. */
export function staleOverview(data: TestsListing | null): StaleOverview | null {
  const names = (data?.yours ?? []).filter((y) => y.freshness?.stale).map((y) => y.name);
  if (!names.length) return null;
  const n = names.length;
  return { names, summary: `${n} of your ${n === 1 ? 'clone' : 'clones'} may be out of date: the flow ${n === 1 ? 'it was' : 'they were'} cloned from has changed.` };
}
