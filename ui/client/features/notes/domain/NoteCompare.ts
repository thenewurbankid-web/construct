// Pure (DOMAIN-001): the Compare view of a stale write, "mine" against "theirs", as one list of lines. A plain
// longest-common-subsequence over lines (common head and tail trimmed first); no model, no dependency.
import type { CompareLine } from './NoteTypes.ts';

/** Above this many differing lines on a side the LCS is skipped: the two texts are simply shown one after the other. */
export const MAX_COMPARE_LINES = 2500;

export function compareLines(mine: string, theirs: string): CompareLine[] {
  const a = mine.split('\n');
  const b = theirs.split('\n');
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail += 1;
  const am = a.slice(head, a.length - tail);
  const bm = b.slice(head, b.length - tail);
  const out: { kind: CompareLine['kind']; text: string }[] = a.slice(0, head).map((text) => ({ kind: 'same', text }));
  if (am.length > MAX_COMPARE_LINES || bm.length > MAX_COMPARE_LINES) {
    out.push(...am.map((text) => ({ kind: 'mine' as const, text })), ...bm.map((text) => ({ kind: 'theirs' as const, text })));
  } else {
    out.push(...middle(am, bm));
  }
  out.push(...a.slice(a.length - tail).map((text) => ({ kind: 'same' as const, text })));
  return out.map((l, key) => ({ key, ...l }));
}

/** Lines only in `a` are "mine", only in `b` are "theirs", the shared ones are "same". */
function middle(a: string[], b: string[]): { kind: CompareLine['kind']; text: string }[] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] = a[i] === b[j] ? table[(i + 1) * width + j + 1] + 1 : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  const out: { kind: CompareLine['kind']; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] });
      i += 1;
      j += 1;
    } else if (table[(i + 1) * width + j] >= table[i * width + j + 1]) {
      out.push({ kind: 'mine', text: a[i] });
      i += 1;
    } else {
      out.push({ kind: 'theirs', text: b[j] });
      j += 1;
    }
  }
  for (; i < n; i += 1) out.push({ kind: 'mine', text: a[i] });
  for (; j < m; j += 1) out.push({ kind: 'theirs', text: b[j] });
  return out;
}

/** True when the title or the text differs, i.e. there is something to choose between. */
export const differs = (mine: { title: string; body: string }, theirs: { title: string; body: string }): boolean => mine.title !== theirs.title || mine.body !== theirs.body;
