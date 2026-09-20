// Pure (DOMAIN-001): everything the Tests screen draws that is DERIVED from its state and the server's listing,
// so components and pages stay presentation-only.
import type { CloneDialog, CloneDialogView, CoverageRow, GeneratedTest, InlinePart, TestSelection, TestsListing, YourTest } from '../types.ts';
import { coverageSummary, rowForFile } from './Coverage.ts';
import { inlineParts } from './InlineText.ts';
import { clonePath, slugify } from './TestNames.ts';

/** First 7 characters of a `sha256:<hex>` hash, for the human-readable lineage note. */
const shortHash = (hash: string | null): string => (hash ? hash.replace(/^sha256:/, '').slice(0, 7) : 'unknown');

/** The clone dialog with its derived text: the slug the server will validate, where it lands, what is recorded. */
export function cloneDialogView(feature: string, d: CloneDialog): CloneDialogView {
  const slug = slugify(d.name);
  return { ...d, slug, savedAs: slug ? clonePath(feature, d.name) : 'Type a name using letters or digits.', lineageNote: `${d.title} · ${shortHash(d.hash)}` };
}

/** The selected test and the scenario it covers (a clone shows the scenario it was cloned from). */
type Selected = { test: GeneratedTest | YourTest | null; row: CoverageRow | null; title: string; steps: InlinePart[][] };
const NONE: Selected = { test: null, row: null, title: '', steps: [] };

export function selectedTest(data: TestsListing | null, sel: TestSelection | null): Selected {
  if (!data || !sel) return NONE;
  const test = (sel.area === 'generated' ? data.generated : data.yours).find((t) => t.name === sel.name) ?? null;
  if (!test) return NONE;
  const file = test.area === 'generated' ? test.name : test.clonedFrom?.file.split('/').pop() ?? '';
  const row = rowForFile(data.coverage, file);
  const title = test.area === 'generated' ? (row?.title ?? test.name) : test.name.replace(/\.spec\.ts$/, '');
  return { test, row, title, steps: (row?.text ?? []).map(inlineParts) };
}

export const summaryOf = (data: TestsListing | null): string => (data ? coverageSummary(data) : '');
