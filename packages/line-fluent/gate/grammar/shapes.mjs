// Sentence shapes: the grammar gate's second pass (T1.4). The word trie (C5 nextWords) accepts only word paths some
// catalog or R9 sentence already uses, so a new atom with a new verb could never pass. A shape is a sentence with its
// content verbs abstracted to a VERB slot and every call marked by whether it takes an argument:
//
//   list(xs).sorts().by(order)  ->  list(·).VERB().by(·)
//
// Frame words keep their place literally (checks, clones, chooses, attempts, yields ...: they decide what kind of
// sentence it is, R2/R4/R5), as do subjects, connectors, role words and question words. A sentence passes the shape
// check when its shape is one a catalog or R9 sentence already has. An unknown word may fill a VERB slot only when it
// reads as a third-person verb (R1: `fills`, `copies`) and is not a near-miss of a known word (a typo keeps the
// trie's replace-word fix); it passes as an alias of the verb class, reported in `aliases` for the person approving.
import { readFileSync } from 'node:fs';
import { parse } from '../../../line-smith/scripts/lib-sentence.mjs';
import { sentences, wordClasses } from '../../grammar/next-words.mjs';
import { editDistance } from './grammar.mjs';

const grammar = JSON.parse(readFileSync(new URL('../../../line-smith/src/atoms/naming.json', import.meta.url), 'utf8')).grammar;

/** Verbs that frame a sentence (its kind, R2/R4/R5) rather than name its action; they never become a slot. */
export const FRAME_VERBS = Object.freeze(['checks', 'clones', 'chooses', 'attempts', 'recovers', 'cleans', 'yields', 'matches']);
const frame = new Set(FRAME_VERBS);
const contentVerbs = new Set(grammar.verbs.filter((v) => !frame.has(v)));

/** Every word the grammar knows, of any class (for telling a typo from a new verb). */
const vocabulary = [...new Set(sentences.flatMap(({ fluent }) => parse(fluent).map((c) => c.word)))];
const known = new Set(vocabulary);

/** R1: a third-person singular verb form, `fills`, `copies`, `pushes`; not `class`, not `is`. */
export function looksLikeVerb(word) {
  return /^[a-z]{3,}s$/.test(word) && !/ss$/.test(word) && !/(ous|ius|us|is)$/.test(word);
}

/**
 * Whether `word` reads as a slip of the known word `known`: same first letter and an edit distance of 1, or the same
 * letters reordered (`yeilds`, `chekcs`). `fills` is not a slip of `finds`, nor `pads` of
 * `has`: those are different words and may be new verbs.
 */
export function isTypo(word, knownWord) {
  if (word === knownWord || word[0] !== knownWord[0]) return false;
  if ([...word].sort().join() === [...knownWord].sort().join()) return true;
  return editDistance(word, knownWord) <= 1; // `removes` is not a slip of `reverses`
}

/** The known word `word` is a slip of, or null. */
export function typoOf(word) {
  return vocabulary.find((k) => isTypo(word, k)) ?? null;
}

const token = (word, args) => `${word}(${args.length ? '·' : ''})`;

/** A known sentence's shape: content verbs as VERB, everything else literal. */
export function shapeOf(fluent) {
  return parse(fluent).map(({ word, args }) => token(contentVerbs.has(word) ? 'VERB' : word, args)).join('.');
}

// Class shapes: the third level. Subjects and role words are abstracted too, and a run of role-word arguments is one
// (R3: every argument is carried by its own role word, so a sentence may carry more than one). A sentence whose exact
// shape is new but whose class shape is known follows the rules; it passes as a new shape, reported for the person to
// confirm, and is a known shape once its atom is registered.
const subjects = new Set(grammar.subjects);
const roles = new Set(grammar.roleWords.filter((w) => !grammar.connectors.includes(w)));

/** `map(m).sets().at(key).to(value)` -> `SUBJECT(·).VERB().ROLE(·)+` */
export function classShapeOf(tokens) {
  const out = [];
  for (const t of tokens) {
    const [, word, arg] = /^([^(]+)\((·?)\)$/.exec(t);
    const cls = subjects.has(word) ? 'SUBJECT' : roles.has(word) ? 'ROLE' : word;
    const tok = `${cls}(${arg})`;
    if (tok === 'ROLE(·)' && (out.at(-1) === 'ROLE(·)' || out.at(-1) === 'ROLE(·)+')) out[out.length - 1] = 'ROLE(·)+';
    else out.push(tok === 'ROLE(·)' ? 'ROLE(·)+' : tok);
  }
  return out.join('.');
}

/** Shape -> one real sentence of that shape (the example a refusal shows). */
export const SHAPES = new Map();
for (const { fluent } of sentences) {
  const s = shapeOf(fluent);
  if (!SHAPES.has(s)) SHAPES.set(s, fluent);
}

/** Class shape -> one real sentence of that class shape. */
export const CLASS_SHAPES = new Map();
for (const [shape, example] of SHAPES) {
  const c = classShapeOf(shape.split('.'));
  if (!CLASS_SHAPES.has(c)) CLASS_SHAPES.set(c, example);
}

function tokenDistance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}

/** The `n` known shapes nearest a shape, each with its example sentence. */
export function nearestShapes(shape, n = 3) {
  const t = shape.split('.');
  return [...SHAPES.entries()]
    .map(([s, example]) => ({ shape: s, example, distance: tokenDistance(t, s.split('.')) }))
    .sort((a, b) => a.distance - b.distance || a.shape.length - b.shape.length)
    .slice(0, n);
}

/**
 * The shape check for a parsed sentence. `pass` with the new verbs as aliases; `fail` with the reason (an unknown
 * word that is not a verb, a near-miss of a known word, or a shape the grammar does not have) and nearest examples.
 * @param {{word: string, args: string[]}[]} calls The parsed sentence.
 * @returns {{check: 'pass' | 'fail', shape: string, aliases: {word: string, class: 'verb'}[], newShape?: {shape: string, like: string}, reason: string | null, typo?: boolean, newVerb?: boolean, nearest: object[]}} The verdict.
 */
export function checkShape(calls) {
  const aliases = [];
  const tokens = [];
  let reason = null;
  let typo = false;
  let newVerb = false;
  for (const { word, args } of calls) {
    if (contentVerbs.has(word)) tokens.push(token('VERB', args));
    else if (known.has(word) || wordClasses(word).length) tokens.push(token(word, args));
    else if (!looksLikeVerb(word)) {
      reason ??= `\`${word}\` is not a word the grammar knows, and only a new verb (a third-person form like \`fills\`) can join it`;
      tokens.push(token(word, args));
    } else if (typoOf(word)) {
      reason ??= `\`${word}\` is a slip of the known word \`${typoOf(word)}\``;
      typo = true;
      tokens.push(token(word, args));
    } else {
      newVerb = true;
      aliases.push({ word, class: 'verb' });
      tokens.push(token('VERB', args));
    }
  }
  const shape = tokens.join('.');
  if (!reason && SHAPES.has(shape)) return { check: 'pass', shape, aliases, reason: null, nearest: [] };
  // A new shape whose word classes follow a known one: it does not break the rules, so it passes, flagged as new.
  if (!reason) {
    const cls = classShapeOf(tokens);
    if (CLASS_SHAPES.has(cls)) return { check: 'pass', shape, aliases, newShape: { shape, like: CLASS_SHAPES.get(cls) }, reason: null, nearest: [] };
  }
  reason ??= `the shape \`${shape}\` is not one the grammar has`;
  return { check: 'fail', shape, aliases: [], reason, typo, newVerb, nearest: nearestShapes(shape) };
}
