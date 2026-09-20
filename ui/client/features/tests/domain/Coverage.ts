// Pure (DOMAIN-001): the words the screen uses for scenario coverage.
import type { CoverageRow, TestsListing } from '../types.ts';

/** "9 scenarios · 7 with a generated test · 2 of your own". */
export function coverageSummary(data: TestsListing): string {
  const covered = data.coverage.filter((c) => c.generated).length;
  return `${data.scenarios} ${data.scenarios === 1 ? 'scenario' : 'scenarios'} · ${covered} with a generated test · ${data.yours.length} of your own`;
}

/** The scenario a generated test covers, if the flow still has it. */
export const rowForFile = (rows: CoverageRow[], file: string): CoverageRow | null => rows.find((r) => r.file === file) ?? null;
