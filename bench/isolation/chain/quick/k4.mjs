// K4 (#942): can a proposal sentence find its atom by the atom registry's `english` (packages/line-atoms/atoms/*/atom.json)?
// Exact (normalized) match first, then nomic-embed-text cosine. No generative model.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ATOMS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', 'packages', 'line-atoms', 'atoms');

/** @returns {{id: string, english: string}[]} every atom with an `english`, in id order. */
export function readAtoms(dir = ATOMS_DIR) {
  return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => {
    const a = JSON.parse(fs.readFileSync(path.join(dir, e.name, 'atom.json'), 'utf8'));
    return { id: a.id, english: a.english };
  }).filter((a) => a.english).sort((a, b) => a.id.localeCompare(b.id));
}

/** 8 proposal sentences from bench/lending/SPEC.md stories, each with its one right atom. Written as a Proposer would. */
export const CASES = Object.freeze([
  { id: 'k4-1', sentence: 'Show the books six at a time and move between the pages with Previous page and Next page.', atom: 'client-pagination', spec: 'BRW-1, BRW-2' },
  { id: 'k4-2', sentence: 'Keep only the books of the chosen genre and order them by title.', atom: 'filter-sort', spec: 'BRW-3, BRW-4' },
  { id: 'k4-3', sentence: 'Wait until the member stops typing in Find a book, then use what they typed to search.', atom: 'debounced-search', spec: 'BRW-5' },
  { id: 'k4-4', sentence: 'Check the name, card number, email and branch, and send the request only when every value is valid.', atom: 'validated-submit', spec: 'REQ-2, REQ-3' },
  { id: 'k4-5', sentence: 'Add the book to the picks at once and take it back off if keeping it fails.', atom: 'optimistic-update', spec: 'BK-2' },
  { id: 'k4-6', sentence: 'Load the loans and say whether they are loading, loaded or failed.', atom: 'async-status', spec: 'LN-1' },
  { id: 'k4-7', sentence: 'Walk the member from the picks to the request form to the confirmation, one step after another.', atom: 'multi-step-flow', spec: 'PCK-6, REQ-3, REQ-4' },
  { id: 'k4-8', sentence: 'Let the member undo removing a book from the picks and redo it.', atom: 'undo-history', spec: 'PCK-2' },
]);

export const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

/** Exact match on normalized English; null when none. */
export const exactMatch = (sentence, atoms) => atoms.find((a) => norm(a.english) === norm(sentence))?.id ?? null;

/** Rank atoms for one sentence vector. @returns {{id: string, score: number}[]} best first */
export function rank(qv, atomVecs, atoms, cosine) {
  return atoms.map((a, i) => ({ id: a.id, score: cosine(qv, atomVecs[i]) })).sort((x, y) => y.score - x.score);
}
