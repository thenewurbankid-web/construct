// Pure (DOMAIN-001): a changed file as the tree shows it (name and status already in words, so the
// components stay presentation-only).
import type { ChangedFile, TreeFile } from '../types.ts';

const STATUS_WORD: Record<ChangedFile['status'], string> = { A: 'added', M: 'modified', D: 'deleted', T: 'type changed' };

export const fileName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

export const toTreeFile = (f: ChangedFile): TreeFile => ({ ...f, name: fileName(f.path), statusLabel: STATUS_WORD[f.status] ?? 'changed' });

/** A flat, sorted list for the `Files` tab. */
export const flatFiles = (files: ChangedFile[]): TreeFile[] => files.map(toTreeFile).sort((a, b) => a.path.localeCompare(b.path));
