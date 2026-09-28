// Pure (DOMAIN-001): the words the screen uses for scenario coverage.
import type { CoverageRow, TestsListing } from '../types.ts';

/** "9 scenarios · 7 with a generated test · 2 of your own", plus " · story: 3/5 matched" when the feature has a
 * story.md (#388) -- omitted entirely otherwise, per design 9.1's "story-dependent UI only when a story.md exists". */
export function coverageSummary(data: TestsListing): string {
  const covered = data.coverage.filter((c) => c.generated).length;
  const base = `${data.scenarios} ${data.scenarios === 1 ? 'scenario' : 'scenarios'} · ${covered} with a generated test · ${data.yours.length} of your own`;
  const story = storyCoverageSummary(data.story);
  return story ? `${base} · ${story}` : base;
}

/** "story: 3/5 matched" (design 9.8's "in sync (3/5 matched)" phrasing) -- '' when there is no story.md. */
export function storyCoverageSummary(story: TestsListing['story']): string {
  if (!story.declared) return '';
  const total = story.acceptance.length;
  return `story: ${story.compare.matched.length}/${total} matched`;
}

/** The scenario a generated test covers, if the flow still has it. */
export const rowForFile = (rows: CoverageRow[], file: string): CoverageRow | null => rows.find((r) => r.file === file) ?? null;
