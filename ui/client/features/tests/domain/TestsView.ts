// Pure (DOMAIN-001): everything the Tests screen draws that is DERIVED from its state and the server's listing,
// so components and pages stay presentation-only.
import type { CloneDialog, CloneDialogView, CoverageRow, GeneratedTest, TestSelection, TestsListing, YourTest } from '../types.ts';
import { coverageSummary, rowForFile } from './Coverage.ts';
import { clonePath, slugify } from './TestNames.ts';

/** First 7 characters of a `sha256:<hex>` hash, for the human-readable lineage note. */
const shortHash = (hash: string | null): string => (hash ? hash.replace(/^sha256:/, '').slice(0, 7) : 'unknown');

/** The clone dialog with its derived text: the slug the server will validate, where it lands, what is recorded. */
export function cloneDialogView(feature: string, d: CloneDialog): CloneDialogView {
  const slug = slugify(d.name);
  return { ...d, slug, savedAs: slug ? clonePath(feature, d.name) : 'Type a name using letters or digits.', lineageNote: `${d.title} · ${shortHash(d.hash)}` };
}

/** The selected test and the scenario it covers (a clone shows the scenario it was cloned from). */
export function selectedTest(data: TestsListing | null, sel: TestSelection | null): { test: GeneratedTest | YourTest | null; row: CoverageRow | null } {
  if (!data || !sel) return { test: null, row: null };
  const test = (sel.area === 'generated' ? data.generated : data.yours).find((t) => t.name === sel.name) ?? null;
  if (!test) return { test: null, row: null };
  const file = test.area === 'generated' ? test.name : test.clonedFrom?.file.split('/').pop() ?? '';
  return { test, row: rowForFile(data.coverage, file) };
}

export const summaryOf = (data: TestsListing | null): string => (data ? coverageSummary(data) : '');
