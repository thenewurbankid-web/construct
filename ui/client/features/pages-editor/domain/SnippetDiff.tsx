import { diffLines } from 'diff';
import type { DiffHunk } from '../types';

// Pure (DOMAIN-001) — line-level diff between a snippet as loaded and as
// currently edited, computed for the save-back confirmation preview (#81).
// diffLines() is a plain text-diffing call, no environment access.
export function diffSnippetLines(before: string, after: string): DiffHunk[] {
  return diffLines(before, after).map((part) => ({
    value: part.value,
    added: part.added,
    removed: part.removed,
  }));
}
