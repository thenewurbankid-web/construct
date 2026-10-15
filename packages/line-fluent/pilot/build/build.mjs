// Built answers (owner, 2026-10-15: "shortest path or nl tools like pos along with the internal models", "finding dead
// ends early"). Most of an answer needs no model:
//
//   js, params   from the reference entry itself (receiver.member(args)) or the catalog atom that already covers it
//   verb         the member's first word, tagged in a verb frame ("you pad it" -> pads) by compromise (MIT)
//   sentence     the shortest path through the grammar's sentence shapes from the receiver's subject that carries
//                every argument, the verb in the VERB slot; a branch that can no longer carry the arguments left is cut
//                (each shape-trie node knows the argument counts still reachable from it)
//
// No path is itself a finding: the entry is a dead end, named by the shape it would need, before any model is asked.
// Every built answer still goes through the C3 gate; the models only get what the rules cannot build.
import nlp from 'compromise';
import { SHAPES } from '../../gate/grammar/shapes.mjs';
import { candidatesFor } from '../../generator/generator.mjs';
import { decode } from '../lexicon/lexicon.mjs';

/** The subject word per receiver generator (R2). */
export const SUBJECT_OF_GEN = { list: 'list', nums: 'list', texts: 'list', text: 'text', num: 'number', nat: 'number', date: 'date', map: 'map', set: 'set', obj: 'record' };
/** The receiver generator per section, for instance members. */
export const RECEIVER_OF_SECTION = { Array: 'list', ReadonlyArray: 'list', String: 'text', Number: 'num', Date: 'date', Map: 'map', ReadonlyMap: 'map', Set: 'set', ReadonlySet: 'set', Object: 'obj', RegExp: 'regex', Boolean: 'bool', BigInt: 'bigint' };
/** A short receiver name per generator (never a subject word, so `list(list)` cannot happen). */
const RECEIVER_NAME = { list: 'xs', text: 's', num: 'n', date: 'd', map: 'm', set: 'st', obj: 'o', regex: 're', bool: 'b', bigint: 'big' };
/** Members that change their receiver. */
const IN_PLACE = new Set(['push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin', 'set', 'delete', 'add', 'clear']);

/** A TS parameter type as a generator name. */
export function genOfType(type = '') {
  const t = type.trim();
  if (/^number\b/.test(t)) return 'num';
  if (/^string\b/.test(t)) return 'text';
  if (/^boolean\b/.test(t)) return 'bool';
  if (/^bigint\b/.test(t)) return 'bigint';
  if (/=>/.test(t)) return /=> (boolean|unknown|value is)/.test(t) ? 'pred' : /=> number/.test(t) ? 'cmp' : 'fn';
  if (/\[\]$|^(Readonly)?Array</.test(t)) return 'list';
  if (/^RegExp\b/.test(t)) return 'regex';
  if (/^Date\b/.test(t)) return 'date';
  return 'prim';
}

/** camelCase words: `padStart` -> ['pad', 'start'], `lastIndexOf` -> ['last', 'index', 'of']. */
export const wordsOf = (name) => String(name).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

/** Programming verbs the tagger's dictionary misses or reads as nouns (pad, search, push, map ...). Data, extendable. */
export const PROGRAMMING_VERBS = new Set(['pad', 'search', 'split', 'push', 'pop', 'map', 'slice', 'splice', 'normalize', 'delete', 'filter', 'copy', 'shift', 'unshift', 'match', 'reverse', 'sort', 'flat', 'flatten', 'clear', 'set', 'sign', 'encode', 'decode', 'escape', 'format', 'parse', 'compare', 'concat', 'append', 'prepend', 'merge', 'group', 'chunk', 'zip', 'fill', 'trim', 'test', 'exec', 'freeze', 'seal', 'bind', 'call', 'apply', 'resolve', 'reject', 'sum', 'round', 'floor', 'truncate', 'wrap']);
const lexicon = nlp.world().model.one.lexicon;
const SAYS_VERB = new Set(['Infinitive', 'PresentTense', 'Verb']);

/** Whether a base word is a real verb: the dictionary says so, our grammar has it, or it is a known programming verb. */
export function isVerb(base, grammarVerbs = new Set()) {
  return SAYS_VERB.has(lexicon[base]) || PROGRAMMING_VERBS.has(base) || grammarVerbs.has(thirdPerson(base));
}

/** R1, regular forms only: pad -> pads, push -> pushes, copy -> copies. */
export function thirdPerson(base) {
  if (/(s|sh|ch|x|z|o)$/.test(base)) return `${base}es`;
  if (/[^aeiou]y$/.test(base)) return `${base.slice(0, -1)}ies`;
  return `${base}s`;
}

/** The member's verb, third person (R1), when its first word is a real verb; else null (a model or person names it). */
export function verbOf(member, grammarVerbs) {
  const [first] = wordsOf(member);
  if (!first || ['to', 'is', 'has', 'get', 'of', 'at', 'with'].includes(first)) return null;
  if (lexicon[first] === 'PresentTense' || grammarVerbs?.has(first)) return first; // includes, already third person
  return isVerb(first, grammarVerbs) ? thirdPerson(first) : null;
}

// ---- the shape trie and the pruned shortest-path search ---------------------------------------------------------

/** Shape tokens: `list(·)`, `VERB()`, `by(·)`. */
const tokensOf = (shape) => shape.split('.');
const takesArg = (tok) => tok.endsWith('(·)');
const wordOf = (tok) => tok.slice(0, tok.indexOf('('));

/** The trie of every known shape; each node knows which argument counts are still reachable from it (the pruning). */
export function shapeTrie(shapes = [...SHAPES.keys()]) {
  const root = { children: new Map(), end: false, reach: new Set() };
  for (const s of shapes) {
    let n = root;
    for (const t of tokensOf(s)) {
      if (!n.children.has(t)) n.children.set(t, { children: new Map(), end: false, reach: new Set() });
      n = n.children.get(t);
    }
    n.end = true;
  }
  (function reach(n) {
    if (n.end) n.reach.add(0);
    for (const [t, c] of n.children) for (const k of reach(c)) n.reach.add(k + (takesArg(t) ? 1 : 0));
    return n.reach;
  })(root);
  return root;
}
const TRIE = shapeTrie();

/**
 * The shortest shapes that start with `subject(·)`, carry exactly `args` arguments in all and have one VERB slot,
 * cheapest first. A branch whose reachable argument counts no longer include what is left is never explored.
 * @returns {{shapes: string[][], explored: number, cut: number}}
 */
export function shortestShapes(subject, args, { limit = 3, trie = TRIE } = {}) {
  const start = trie.children.get(`${subject}(·)`);
  const out = [];
  let explored = 0;
  let cut = 0;
  if (!start || !start.reach.has(args - 1)) return { shapes: out, explored, cut: 1 };
  const queue = [{ node: start, path: [`${subject}(·)`], left: args - 1, verbs: 0 }];
  while (queue.length && out.length < limit) {
    const { node, path, left, verbs } = queue.shift();
    explored++;
    if (node.end && left === 0 && verbs === 1) out.push(path);
    for (const [t, c] of node.children) {
      const need = left - (takesArg(t) ? 1 : 0);
      const v = verbs + (wordOf(t) === 'VERB' ? 1 : 0);
      if (need < 0 || !c.reach.has(need) || v > 1 || (wordOf(t) === 'VERB' && takesArg(t))) {
        cut++;
        continue;
      }
      queue.push({ node: c, path: [...path, t], left: need, verbs: v });
    }
  }
  return { shapes: out, explored, cut };
}

/** A shape filled in: subject and role arguments in parameter order, the verb in the VERB slot. */
export function fill(shape, verb, names) {
  let i = 0;
  return shape.map((t) => {
    const w = wordOf(t) === 'VERB' ? verb : wordOf(t);
    return `${w}(${takesArg(t) ? names[i++] : ''})`;
  }).join('.');
}

// ---- answers --------------------------------------------------------------------------------------------------------

const member = (entry) => entry.key.replace(/ #\d+$/, '').split('.').at(-1);
const instanceOf = (entry) => /\.prototype\.|#/.test(entry.key);

/** The atom the reference entry itself gives: js as the plain call, params receiver first. Null when it has none. */
export function staticAtom(entry) {
  if (!instanceOf(entry) || entry.kind !== 'method') return null;
  const gen = RECEIVER_OF_SECTION[entry.section] ?? RECEIVER_OF_SECTION[entry.section?.replace(/^Readonly/, '')];
  if (!gen) return null;
  const recv = RECEIVER_NAME[gen];
  const args = (entry.params ?? []).filter((p) => !p.optional && !p.rest);
  const m = member(entry);
  return {
    js: `${recv}.${m}(${args.map((p) => p.name).join(', ')})`,
    params: [[recv, gen], ...args.map((p) => [p.name, genOfType(p.type)])],
    kind: IN_PLACE.has(m) ? 'in-place' : 'value',
    member: m,
  };
}

/** The sentences the rules can build for an atom's params and member name, shortest first. */
export function buildSentences(params, memberName, { limit = 3 } = {}) {
  const subject = SUBJECT_OF_GEN[params[0]?.[1]];
  const verb = verbOf(memberName);
  if (!subject) return { sentences: [], deadEnd: `no subject word for a ${params[0]?.[1] ?? 'missing'} receiver` };
  if (!verb) return { sentences: [], deadEnd: `“${wordsOf(memberName).join(' ')}” does not start with a verb` };
  const { shapes, explored, cut } = shortestShapes(subject, params.length, { limit });
  if (!shapes.length) return { sentences: [], deadEnd: `no shape ${subject}(·).VERB() carrying ${params.length - 1} more argument${params.length === 2 ? '' : 's'}`, explored, cut };
  return { sentences: shapes.map((s) => fill(s, verb, params.map(([n]) => n))), explored, cut };
}

/** Words of a member name that carry no meaning of their own (they are role words or the frame). */
const FILLER = new Set(['to', 'of', 'at', 'by', 'with', 'from', 'is', 'has', 'get', 'set', 'in', 'on', 'for', 'and', 'locale']);

/**
 * Coverage: every meaningful word of the member name shows in the sentence (inside a word counts: `lowercases`
 * covers lower and case). `padStart` cannot become `text(s).pads().by(n)`, which would say the same as padEnd.
 */
export function covers(sentence, memberName) {
  const said = sentence.replace(/\([^()]*\)/g, ' ').toLowerCase();
  return wordsOf(memberName).filter((w) => !FILLER.has(w)).every((w) => said.includes(w.replace(/e$/, '')));
}

const camel = (words) => words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('');
/** R8: the atom name is the sentence's words after the subject. */
export const atomName = (sentence) => camel(sentence.replace(/\([^()]*\)/g, '').split('.').filter(Boolean).slice(1));

/** Catalog params in [name, gen] form, from a curated check set or a generated check. */
function catalogParams(atom) {
  if (Array.isArray(atom.check)) return atom.check[0]?.params ?? null;
  if (atom.check?.params) {
    const own = atom.check.params.filter((p) => !p.optional && !p.rest).map((p) => [p.name, p.gen]);
    return atom.check.receiver ? [[RECEIVER_NAME[atom.check.receiver] ?? 'x', atom.check.receiver], ...own] : own;
  }
  return null;
}

/**
 * Every answer the rules can build for an entry, best first: reuse of a covering catalog atom (its own sentence, or
 * a built one), then a new atom from the entry itself. `deadEnds` says why nothing could be built, for the record.
 */
export function builtAnswers(entry, catalog, { lexicon = null, verbWords = null } = {}) {
  const out = [];
  const deadEnds = [];
  for (const c of candidatesFor(entry, catalog)) {
    const atom = catalog.find((a) => a.atom === c.atom);
    const params = catalogParams(atom);
    if (!params) continue;
    const js = atom.js.find((j) => j.includes(member(entry))) ?? atom.js[0];
    const sentences = atom.fluent ? [atom.fluent] : buildSentences(params, member(entry)).sentences.filter((x) => covers(x, member(entry)));
    for (const sentence of sentences) {
      out.push({ entry: entry.id, decision: 'existing', atom: null, existing: atom.atom, kind: atom.fluent?.startsWith('clones(') ? 'copy' : atom.mutates ? 'in-place' : 'value', sentence, js, params, parts: null, reason: null });
    }
  }
  const s = staticAtom(entry);
  if (s) {
    const built = buildSentences(s.params, s.member);
    if (built.deadEnd) deadEnds.push(built.deadEnd);
    // The learned lexicon decodes more candidates (pilot/lexicon): shapes framed by clones() or checks().if() too.
    const decoded = lexicon ? decode(lexicon, { ...s, verbWords, k: 4 }).map((d) => d.sentence) : [];
    // A sentence must say every meaningful word of the member, and must not already mean other code.
    const taken = (sentence) => catalog.some((a) => a.fluent === sentence && !a.js.includes(s.js));
    const kept = [...new Set([...built.sentences, ...decoded])].filter((x) => covers(x, s.member) && !taken(x));
    if (!kept.length && (built.sentences.length || decoded.length)) deadEnds.push(`no shape says every word of “${wordsOf(s.member).join(' ')}”`);
    for (const sentence of kept) {
      out.push({ entry: entry.id, decision: 'new-atom', atom: atomName(sentence), existing: null, kind: s.kind, sentence, js: s.js, params: s.params, parts: null, reason: null });
    }
  } else deadEnds.push(instanceOf(entry) ? `no test inputs for ${entry.section} receivers` : `${entry.kind} entries are not built by rules yet`);
  return { answers: out, deadEnds };
}
