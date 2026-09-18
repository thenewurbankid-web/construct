import { diffLines } from 'diff';
import type { DiffHunk } from '../types';

const CONTEXT = 2;

// Pure (DOMAIN-001) — line diff between the workflow file as it is on disk
// and as it would be after a proposed visual edit, for the confirm step.
// Unchanged stretches are trimmed to CONTEXT lines around each change so the
// preview shows what changed, not the whole file.
export function diffSourceLines(before: string, after: string): DiffHunk[] {
  const parts = diffLines(before, after);
  return parts.map((part, i) => {
    if (part.added || part.removed) return { value: part.value, added: part.added, removed: part.removed };
    const lines = part.value.replace(/\n$/, '').split('\n');
    const first = i === 0;
    const last = i === parts.length - 1;
    const keepHead = first ? 0 : CONTEXT;
    const keepTail = last ? 0 : CONTEXT;
    if (lines.length <= keepHead + keepTail) return { value: part.value };
    const head = lines.slice(0, keepHead);
    const tail = lines.slice(lines.length - keepTail);
    return { value: [...head, '…', ...tail].join('\n') + '\n' };
  });
}
