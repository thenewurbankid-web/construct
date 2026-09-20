// Pure (DOMAIN-001): what the clone dialog opens with, and the plain-language reasons it opens for.
import type { CloneDialog, TestsListing } from '../types.ts';
import { rowForFile } from './Coverage.ts';
import { defaultCloneName } from './TestNames.ts';

/** Why a locked test cannot simply be edited: said in words, not as a rule id or a file-permission error. */
export const LOCK_REASON = 'Construct rewrites generated tests every time the flow changes, so an edit here would disappear. A clone is yours: nothing regenerates it.';

export const editStepReason = (step: number): string => `You tried to change step ${step}: generated tests cannot be edited.`;

/** The dialog for cloning one generated test, or null when that test is not in the listing. */
export function cloneDialogFor(data: TestsListing, file: string, reason: string): Omit<CloneDialog, 'busy' | 'error'> | null {
  const test = data.generated.find((g) => g.name === file);
  if (!test) return null;
  const row = rowForFile(data.coverage, file);
  const title = row?.title ?? test.lineage.title ?? file.replace(/\.spec\.ts$/, '');
  return { source: file, title, hash: test.lineage.machineHash, steps: row?.text.length ?? 0, reason, name: defaultCloneName(title) };
}
