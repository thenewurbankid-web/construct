// C5 (docs/line/FLUENT-PLAN-2026-10-15.md): the words that may come next in a fluent sentence.
// The base of the LSP completions and diagnostics. Data only, no model:
//   - the sentences: every catalog `fluent` form (R1-R8) plus the R9 every() tables in naming.json;
//   - the word classes: naming.json `grammar` (every sentence word must belong to one).
//
//   nextWords('checks().if(a).is()') -> { legal: ['an', 'at', 'boolean', ...], complete: false }
//
// The sentences form a trie of words (arguments are opaque). R9 bodies nest: inside an every()
// sentence, a node whose last two words the data shows taking a binder (`clone.by` -> every(y),
// `kept.if` -> any(y)) is a nest point, so every(x).in(rows)...by().every(y).in(x)...by().every(z)...
// is accepted at any depth.

import { readFileSync } from 'node:fs';
import { parse } from '../../line-smith/scripts/lib-sentence.mjs';

const atomsDir = new URL('../../line-smith/src/atoms/', import.meta.url);
const readJson = (name) => JSON.parse(readFileSync(new URL(name, atomsDir), 'utf8'));

const grammar = readJson('naming.json').grammar;
const catalog = readJson('catalog.json');
const ev = grammar.every;

/** Every sentence the grammar is built from: { fluent, source }. */
export const sentences = [
  ...catalog.atoms.filter((a) => a.fluent).map((a) => ({ fluent: a.fluent, source: `catalog:${a.atom}` })),
  ...['sentences', 'nested', 'shapes', 'async', 'nestedAsync'].flatMap((k) =>
    (ev[k] ?? []).map((s) => ({ fluent: s.fluent, source: `every.${k}` })),
  ),
];

/** The closed word classes of naming.json `grammar`; a word may belong to several. */
const classes = {
  verb: grammar.verbs,
  question: grammar.questionWords,
  subject: grammar.subjects,
  connector: grammar.connectors,
  role: grammar.roleWords,
  word: grammar.words,
  argumentVerb: Object.keys(grammar.argumentVerbs),
  start: Object.keys(ev.starts),
  binder: ev.binders,
  participle: ev.participles,
  gerund: ev.gerunds,
  everyRole: ev.roleWords,
  everyWord: ev.words,
  // R10: the return clause, `.andThe().<name>()`.
  returnWord: grammar.returnWords ?? [],
  returned: grammar.returned ?? [],
};

/** The classes `word` belongs to (empty when the data does not know it). */
export function wordClasses(word) {
  return Object.entries(classes).filter(([, ws]) => ws.includes(word)).map(([c]) => c);
}

// The trie. Each node: { word, parent, children: Map<word, node>, end: boolean }.
const newNode = (word, parent) => ({ word, parent, children: new Map(), end: false });
const root = newNode(null, null);
for (const { fluent } of sentences) {
  let node = root;
  for (const { word } of parse(fluent)) {
    if (!node.children.has(word)) node.children.set(word, newNode(word, node));
    node = node.children.get(word);
  }
  node.end = true;
}

const allNodes = [];
(function walk(n) {
  allNodes.push(n);
  for (const c of n.children.values()) walk(c);
})(root);

const binders = new Set(ev.binders);

/** True when the path to `n` is inside an R9 sentence (a binder followed by `in`). */
function insideR9(n) {
  const words = [];
  for (let m = n; m && m.word !== null; m = m.parent) words.unshift(m.word);
  return words.some((w, i) => binders.has(w) && words.indexOf('in', i) > i);
}

/** A node's context: its last two words (`clone.by`, `kept.if`). */
const keyOf = (n) => `${n.parent?.word}.${n.word}`;

/**
 * Nest points: for each R9 context the data shows taking a binder, the nodes that binder leads to.
 * `every(x).in(rows)...clone().by().every(y)` makes `clone.by` a nest point taking `every`.
 */
const nestTargets = new Map();
for (const n of allNodes) {
  if (n.word === null || !insideR9(n)) continue;
  for (const [w, child] of n.children) {
    if (!binders.has(w)) continue;
    const key = keyOf(n);
    if (!nestTargets.has(key)) nestTargets.set(key, new Map());
    const byWord = nestTargets.get(key);
    if (!byWord.has(w)) byWord.set(w, new Set());
    byWord.get(w).add(child);
  }
}
const nestOf = (n) => (n.word !== null && insideR9(n) ? nestTargets.get(keyOf(n)) : undefined);

/** The nodes reached from `node` by `word`, nest jumps included. */
function step(node, word) {
  const out = new Set();
  if (node.children.has(word)) out.add(node.children.get(word));
  for (const n of nestOf(node)?.get(word) ?? []) out.add(n);
  return out;
}

function legalAfter(node) {
  return new Set([...node.children.keys(), ...(nestOf(node)?.keys() ?? [])]);
}

/** Splits a prefix into its whole calls and a trailing partial word (being typed). */
function split(prefix) {
  const text = prefix.trim();
  const m = text.match(/(?:^|\.)([A-Za-z_$][\w$]*)?$/);
  if (m && !text.endsWith(')')) {
    const partial = m[1] ?? '';
    const head = text.slice(0, text.length - m[0].length);
    return { calls: head ? parse(head) : [], partial };
  }
  return { calls: text ? parse(text) : [], partial: '' };
}

/**
 * C5: `{ legal, complete }` for a fluent sentence so far. `legal` are the words that may come next
 * (sorted; filtered by a trailing partial word); `complete` is true when the prefix is a whole
 * sentence. A prefix the grammar refuses gets `{ legal: [], complete: false }`.
 */
export function nextWords(prefix) {
  let calls;
  let partial;
  try {
    ({ calls, partial } = split(prefix ?? ''));
  } catch {
    return { legal: [], complete: false };
  }
  let states = new Set([root]);
  for (const { word } of calls) {
    const next = new Set();
    for (const s of states) for (const n of step(s, word)) next.add(n);
    if (!next.size) return { legal: [], complete: false };
    states = next;
  }
  const legal = new Set();
  for (const s of states) for (const w of legalAfter(s)) legal.add(w);
  return {
    legal: [...legal].filter((w) => w.startsWith(partial)).sort(),
    complete: !partial && [...states].some((s) => s.end),
  };
}
