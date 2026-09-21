// Pure before/after text diff -> a renderer-agnostic view model (#224).
// Uses the `diff` package (jsdiff, BSD-3-Clause) for the actual diffing;
// this module only shapes hunks into numbered rows with collapsed context,
// so any renderer (plain DOM today, Monaco later) can consume the same data.
import { diffLines } from 'diff';

const gap = (hidden) => ({ kind: 'gap', text: `${hidden} unchanged line${hidden === 1 ? '' : 's'}`, hidden });

/**
 * Build a line diff view of two texts, with a few lines of context around each change and gaps collapsed.
 *
 * @param {string} before
 * @param {string} after
 * @param {{context?: number}} [opts] unchanged lines kept around each change
 * @returns {{rows: Array<{kind:'context'|'added'|'removed'|'gap', oldLine?:number, newLine?:number, text:string, hidden?:number}>, stats:{added:number,removed:number}}}
 */
export function buildDiffView(before, after, { context = 3 } = {}) {
  const full = [];
  let oldLine = 1;
  let newLine = 1;
  const stats = { added: 0, removed: 0 };
  for (const part of diffLines(before, after)) {
    const lines = part.value.replace(/\n$/, '').split('\n');
    for (const text of lines) {
      if (part.added) { full.push({ kind: 'added', newLine: newLine++, text }); stats.added++; }
      else if (part.removed) { full.push({ kind: 'removed', oldLine: oldLine++, text }); stats.removed++; }
      else full.push({ kind: 'context', oldLine: oldLine++, newLine: newLine++, text });
    }
  }
  // Keep only context rows within `context` lines of a change; collapse the rest into gap rows.
  const keep = new Array(full.length).fill(false);
  full.forEach((r, i) => {
    if (r.kind === 'context') return;
    for (let j = Math.max(0, i - context); j <= Math.min(full.length - 1, i + context); j++) keep[j] = true;
  });
  const rows = [];
  let hidden = 0;
  full.forEach((r, i) => {
    if (keep[i]) {
      if (hidden) { rows.push(gap(hidden)); hidden = 0; }
      rows.push(r);
    } else hidden++;
  });
  if (hidden) rows.push(gap(hidden));
  return { rows, stats };
}
