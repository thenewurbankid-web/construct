// Pure (DOMAIN-001): a unified diff split into lines tagged for colouring. Presentation only: the text is untouched.
import type { DiffLine } from './ReviewTypes.ts';

export function diffLines(diff: string | null): DiffLine[] {
  if (!diff) return [];
  const lines = diff.replace(/\n$/, '').split('\n');
  return lines.map((text, key) => {
    let kind: DiffLine['kind'] = 'ctx';
    if (text.startsWith('@@')) kind = 'hunk';
    else if (/^(diff --git|index |--- |\+\+\+ |new file|deleted file|similarity|old mode|new mode)/.test(text)) kind = 'meta';
    else if (text.startsWith('+')) kind = 'add';
    else if (text.startsWith('-')) kind = 'del';
    return { key, kind, text };
  });
}
