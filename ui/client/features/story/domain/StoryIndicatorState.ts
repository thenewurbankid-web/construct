// Pure (DOMAIN-001): maps `StoriesApi.get`'s response to a `StoryIndicatorState` -- the subset of design 9.8's
// states a stored file can answer on its own (no-story, edited-by-hand, stale-vs-code, in-sync). The remaining
// states (checking, using-snapshot, approve-host, re-pick, login-only-no-pattern, ticket-changed) only occur
// mid-fetch/consent and are set by whatever component drives that flow, not by reading the file.
//
// A story.md with no tool block ("direct-content": a story written by hand, never fetched) is deliberately left
// as `null` (unknown, render nothing): `compareStory` on the server always compares against `tool?.acceptance ??
// []`, so with no tool block `matched`/`total` would always read 0/0 -- a real gap (comparing hand-written
// acceptance text against code has no server support yet), not a case to paper over with a wrong count.
//
// `in-sync`'s `via` is unverifiable today: `sources` front matter (the only place a fetch strategy could be
// recorded) is parsed by `parseStory` but nothing in the codebase writes to it yet (no `via`/`sources` param on
// `writeStorySnapshot`), so a `tool` block can only have come from the one fetch path currently wired end to
// end (`StoryApi.fetch`'s `via: 'server'`). Defaulting to `'server'` here is that fact, not a guess; revisit the
// moment `sources` gains a writer (#386/#387) or a second strategy ships (flagged on #385).
import type { StoryView } from '../services/StoriesApi';
import type { StoryIndicatorState } from '../types';

/** `null` when the view could not be read, or answered by a state this mapper does not cover yet (see above) --
 * callers should render nothing, not guess. */
export function buildStoryIndicatorState(view: StoryView): StoryIndicatorState | null {
  if (!view.ok) return null;
  if (!view.exists) return { kind: 'no-story' };
  const { tool, compare } = view;
  if (tool === null) return null;
  if (tool.handEdited) return { kind: 'edited-by-hand' };
  if (view.driftHash !== view.reviewedHash) return { kind: 'stale-vs-code' };
  return { kind: 'in-sync', matched: compare.matched.length, total: tool.acceptance.length, via: 'server' };
}
