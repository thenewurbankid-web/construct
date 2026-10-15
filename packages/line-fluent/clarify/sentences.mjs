// Clarify, for sentences: the person asks for something in plain English; a model suggests Atomic English sentences;
// each is built into its atom and tested statically before the person sees it (clarify.mjs, steps 1-5).
//
//   check(sentence)  grammar (shapes, gate/grammar) -> the catalog atom with exactly this word path and argument
//                    count -> its JS with the sentence's own names -> run on Smith's generated inputs for the atom's
//                    parameter types; it holds up only when no run breaks. A sentence that needs a new verb has no
//                    atom yet, so it cannot be built here: it goes to step 5.
//   draft(q, ex)     step 5: a model writes a sentence (a known shape, a new verb allowed) and its JS for the
//                    person's example; check(..., {example}) runs that JS on the example and must reproduce it exactly.
import { readFileSync } from 'node:fs';
import fc from 'fast-check';
import { parse } from '../../line-smith/scripts/lib-sentence.mjs';
import { arb } from '../../line-smith/test/support/gens.mjs';
import { checkGrammar } from '../gate/grammar/grammar.mjs';
import { FRAME_VERBS } from '../gate/grammar/shapes.mjs';
import { runAnswer } from '../gate/equivalence/equivalence.mjs';
import { SHAPES_SECTION } from '../pilot/request/request.mjs';
import { claudeArgs, runClaude } from '../pilot/runner/claude-model.mjs';

const NAMING = JSON.parse(readFileSync(new URL('../../line-smith/src/atoms/naming.json', import.meta.url), 'utf8')).grammar;
const CONTENT_VERBS = new Set(NAMING.verbs.filter((v) => !FRAME_VERBS.includes(v)));
const CATALOG = JSON.parse(readFileSync(new URL('../../line-smith/src/atoms/catalog.json', import.meta.url), 'utf8')).atoms;
const SAMPLES = 12;

/** Small, readable values per generator: what a person is shown in a question. Random values stay for the "never
 * breaks" test; a person never has to read `2.33e+242`. */
export const READABLE = {
  num: [3, 10], nat: [2, 5], smallint: [2], pos: [2], nzint: [2], digits: [2], unit: [0.5],
  bigint: [12n], smallbigint: [3n], bool: [true, false],
  text: ['Hello world', 'apple'], shorttext: [', ', '-'], spacedtext: ['  hi  '], numtext: ['42'], isotext: ['2026-01-15'],
  key: ['name'], keys: [['name', 'age']], obj: [{ name: 'Ann', age: 30 }], objornull: [{ name: 'Ann', age: 30 }],
  prim: [3, 'a'], mixed: [[3, 1, 2], 'apple', 3], nullish: [null, 3],
  list: [[3, 1, 2], [10, 2, 1], ['pear', 'apple', 'fig']], // [10, 2, 1] tells sorting numbers from sorting as text list1: [[3, 1, 2]], listornull: [[3, 1, 2]], nums: [[3, 1, 2]], nested: [[1, [2, [3]]]],
  pairs: [[['a', 1], ['b', 2]]], anypairs: [[['a', 1], ['b', 2]]],
  date: [new Date('2026-01-15T00:00:00Z')],
  cmp: [(a, b) => a - b], pred: [(x) => x > 1], fn: [(x) => x * 2], keyfn: [(x) => (x > 1 ? 'big' : 'small')], fnnested: [(x) => [x, x]],
  undef: [undefined],
};

const isName = (arg) => /^[A-Za-z_$][\w$]*$/.test(arg);

const wordsOf = (calls) => calls.map((c) => c.word).join('.');
const argsOf = (calls) => calls.flatMap((c) => c.args);

/** Catalog atoms by word path: `list.joins.with` -> [joinWith]. */
const BY_PATH = new Map();
for (const atom of CATALOG) {
  if (!atom.fluent) continue;
  const key = wordsOf(parse(atom.fluent));
  if (!BY_PATH.has(key)) BY_PATH.set(key, []);
  BY_PATH.get(key).push(atom);
}

const show = (v) => {
  if (typeof v === 'function') return v.toString();
  let s;
  try {
    s = typeof v === 'string' ? JSON.stringify(v) : v instanceof Date ? v.toISOString() : JSON.stringify(v, (k, x) => (typeof x === 'bigint' ? `${x}n` : x));
  } catch {
    s = String(v);
  }
  return s === undefined ? 'nothing' : s.length > 60 ? `${s.slice(0, 57)}...` : s;
};
const swap = (text, from, to) => from.reduce((t, name, i) => t.replace(new RegExp(`\\b${name}\\b`, 'g'), to[i] ?? name), text);

/**
 * A sentence resolved to its catalog atom: JS and plain reading in the sentence's own names. Null when no atom has
 * this word path and argument count.
 * @param {string} sentence An Atomic English sentence.
 * @returns {{atom: object, js: string, plain: string, params: string[], args: string[], inputs: {name: string, gen: string}[]} | null} The resolution.
 */
export function resolveSentence(sentence) {
  let calls;
  try {
    calls = parse(sentence);
  } catch {
    return null;
  }
  const args = argsOf(calls);
  const atom = (BY_PATH.get(wordsOf(calls)) ?? []).find((a) => argsOf(parse(a.fluent)).length === args.length);
  if (!atom) return null;
  const params = (atom.check?.[0]?.params ?? []).map(([name]) => name);
  const fluentArgs = argsOf(parse(atom.fluent));
  const gensOf = (atom.check?.[0]?.params ?? []).map(([, g]) => g);
  // The person's inputs: the sentence's arguments that are names (a literal like 18 is part of the sentence).
  const inputs = args.map((a, i) => ({ name: a, gen: gensOf[i] })).filter((x) => isName(x.name));
  return { atom, params, args, inputs, js: swap([].concat(atom.js)[0], params, args), plain: swap(atom.reads ?? atom.fluent, fluentArgs, args) };
}

/** Runs an atom's JS on generated inputs for each of its parameter sets; the first set that never breaks wins. */
async function holdsUp(atom) {
  const template = [].concat(atom.js)[0];
  let lastBreak = null;
  for (const set of atom.check ?? []) {
    const names = set.params.map(([n]) => n);
    let gensFor;
    try {
      gensFor = fc.tuple(...set.params.map(([, g]) => arb(g)));
    } catch {
      continue; // a generator this build does not have
    }
    const samples = names.length ? fc.sample(gensFor, { numRuns: SAMPLES, seed: 7 }) : [[]];
    let first = null;
    let broke = null;
    for (const values of samples) {
      const run = await runAnswer(template, names, values);
      if (run.throws) {
        broke = { names, values, error: run.throws.name };
        break;
      }
      first ??= { names, values, out: run.ok };
    }
    if (!broke && first) return { ok: true, sample: first };
    lastBreak = broke ?? lastBreak;
  }
  return { ok: false, broke: lastBreak };
}

/**
 * Step 3 for a sentence: built and tested statically, or the plain reason it does not hold up. With `example`
 * (step 5), the sentence's own JS must reproduce the person's example exactly.
 * @param {string} sentence The sentence.
 * @param {{example?: {inputs: Record<string, any>, output: any} | string, js?: string}} [opts] Step 5's parsed example and drafted JS.
 * @returns {Promise<{ok: boolean, plain: string, example?: string, reason?: string, js?: string, atom?: string, aliases?: object[]}>} The verdict.
 */
export async function checkSentence(sentence, opts = {}) {
  const grammar = checkGrammar({ sentence });
  if (grammar.check !== 'pass') return { ok: false, plain: sentence, reason: `it does not read as Atomic English (${grammar.errors[0]})` };
  if (opts.js) return checkDraft(sentence, opts, grammar);
  const r = resolveSentence(sentence);
  if (!r) {
    const verbs = (grammar.aliases ?? []).map((a) => `“${a.word}”`).join(', ');
    return { ok: false, plain: sentence, aliases: grammar.aliases ?? [], reason: verbs ? `it uses the new verb ${verbs}, which no atom does yet` : 'no atom says exactly this yet' };
  }
  const tested = await holdsUp(r.atom);
  if (!tested.ok) {
    const b = tested.broke;
    return { ok: false, plain: r.plain, reason: b ? `it breaks: with ${b.names.map((n, i) => `${n} = ${show(b.values[i])}`).join(', ')} it throws ${b.error}` : 'it has no inputs to test it with' };
  }
  const values = readableCase(r.inputs, 0);
  const run = await runAnswer(r.js, r.inputs.map((x) => x.name), r.inputs.map((x) => values[x.name]));
  const given = r.inputs.map((x) => `${x.name} = ${show(values[x.name])}`).join(', ');
  return {
    ok: true, plain: r.plain, js: r.js, atom: r.atom.atom, inputs: r.inputs, literals: r.args.filter((x) => !isName(x)).join(','),
    example: `${given ? `with ${given}` : 'with nothing'}, it gives ${run.throws ? `an error (${run.throws.name})` : show(run.ok)}`,
  };
}

/**
 * Options that are the same atom with the same literal arguments, differing only in what an input is called, are one
 * option to a person: keep the first (its names come from the request).
 */
export function dedupeOptions(options) {
  const seen = new Set();
  return options.filter((o) => {
    const key = o.atom ? `${o.atom}|${o.literals ?? ''}` : o.js;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** The k-th readable case for a set of inputs: {name: value}, cycling each input's readable values. */
export function readableCase(inputs, k) {
  return Object.fromEntries(inputs.map((x, i) => {
    const pool = READABLE[x.gen] ?? READABLE.prim;
    return [x.name, pool[(k + i) % pool.length]];
  }));
}

export { show };

/**
 * The person's own word in place of the sentence's verb: `clones().list(p).and().sorts().by(o)` with "order" ->
 * `clones().list(p).and().orders().by(o)`. The base form takes R1's third person. Null when the sentence has no
 * content verb to swap or the word is not one plain word.
 */
export function withVerb(sentence, word) {
  const w = String(word).trim().toLowerCase();
  if (!/^[a-z]+$/.test(w)) return null;
  const third = w.endsWith('s') ? w : /(ch|sh|x|z|o)$/.test(w) ? `${w}es` : /[^aeiou]y$/.test(w) ? `${w.slice(0, -1)}ies` : `${w}s`;
  const calls = parse(sentence);
  const i = calls.findIndex((c) => CONTENT_VERBS.has(c.word));
  if (i < 0) return null;
  return sentence.replace(new RegExp(`\\b${calls[i].word}\\(`), `${third}(`);
}

// ---- from code: the code fixes the behaviour -------------------------------------------

const cloneValue = (v) => {
  try {
    return structuredClone(v);
  } catch {
    return v; // functions and the like are not changed by a run
  }
};

/** One run as comparable words: what it gives (or the error's name), and the inputs afterwards (a change in place). */
async function outcome(js, names, values) {
  const own = values.map(cloneValue);
  const r = await runAnswer(js, names, own);
  return { gives: r.throws ? `an error (${r.throws.name})` : show(r.ok), after: own.map(show).join(' | ') };
}

/**
 * Code mode (owner, 2026-10-15: Line converts code it parsed, so the code fixes the behaviour). The sentence must hold
 * up as in checkSentence and do exactly what `code` does: the same result, and the same change to its inputs, on the
 * readable cases and on generated inputs for the atom's parameter types. No person is asked what should come out.
 * @param {string} sentence The sentence.
 * @param {string} code The original JS expression, over the same input names.
 * @returns {Promise<object>} checkSentence's verdict, refused with the first case where the two differ.
 */
export async function checkAgainstCode(sentence, code) {
  const verdict = await checkSentence(sentence);
  if (!verdict.ok) return verdict;
  const r = resolveSentence(sentence);
  const names = r.inputs.map((x) => x.name);
  const cases = [0, 1, 2, 3].map((k) => readableCase(r.inputs, k)).map((c) => names.map((n) => c[n]));
  for (const set of r.atom.check ?? []) {
    try {
      const gens = fc.tuple(...set.params.map(([, g]) => arb(g)));
      const idx = r.args.map((a, i) => (isName(a) ? i : -1)).filter((i) => i >= 0);
      for (const values of fc.sample(gens, { numRuns: SAMPLES, seed: 11 })) cases.push(idx.map((i) => values[i]));
    } catch {
      // a generator this build does not have: readable cases only
    }
  }
  for (const values of cases) {
    const mine = await outcome(verdict.js, names, values);
    const theirs = await outcome(code, names, values);
    if (mine.gives !== theirs.gives || mine.after !== theirs.after) {
      const given = names.map((n, i) => `${n} = ${show(values[i])}`).join(', ');
      const what = mine.gives !== theirs.gives ? `the code gives ${theirs.gives} but this gives ${mine.gives}` : `the code leaves the inputs as ${theirs.after} but this leaves them as ${mine.after}`;
      return { ...verdict, ok: false, reason: `it does not do what the code does: with ${given}, ${what}` };
    }
  }
  return { ...verdict, code };
}

/** Step 5: the drafted JS run on the person's example; it must give exactly their output. */
async function checkDraft(sentence, { js, example }, grammar) {
  const names = Object.keys(example.inputs ?? {});
  const run = await runAnswer(js, names, names.map((n) => example.inputs[n]));
  const given = names.map((n) => `${n} = ${show(example.inputs[n])}`).join(', ');
  if (run.throws) return { ok: false, plain: sentence, reason: `on your example it throws ${run.throws.name}` };
  if (show(run.ok) !== show(example.output)) return { ok: false, plain: sentence, reason: `on your example it gives ${show(run.ok)}, not ${show(example.output)}` };
  return { ok: true, plain: sentence, js, aliases: grammar.aliases ?? [], example: `with ${given}, it gives ${show(run.ok)}` };
}

// ---- the model's side: English in, English out --------------------------------------

// The model's prompt is built per request: only the catalog sentences that bear on this request, everything the
// person has confirmed so far, and what has been ruled out, so each round of suggestions is aimed, not guessed.
const STOP = new Set(['the', 'and', 'with', 'that', 'this', 'for', 'from', 'into', 'what', 'should', 'give', 'gives', 'come', 'out', 'want', 'each', 'every', 'have', 'list', 'text']);
const tokens = (text) => String(text).toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2 && !STOP.has(w));
const atomText = (a) => `${a.reads} ${a.fluent} ${a.atom.replace(/([A-Z])/g, ' $1')} ${a.module}`;

/**
 * The catalog sentences most relevant to a request and its confirmed facts (word overlap with each atom's reading,
 * sentence, name and module), best first; at most `max`.
 */
export function relevantCatalog(question, facts = [], max = 30) {
  const want = new Set(tokens(`${question} ${facts.map((f) => `${f.given} ${f.output}`).join(' ')}`));
  return CATALOG.filter((a) => a.fluent)
    .map((a, i) => ({ a, i, score: tokens(atomText(a)).filter((w) => want.has(w)).length }))
    .sort((x, y) => y.score - x.score || x.i - y.i)
    .slice(0, max)
    .map(({ a }) => a);
}

/**
 * The suggestion prompt for one request: {system, user}. Built fresh each round from the request, the relevant
 * catalog, the person's confirmed facts and the sentences already ruled out.
 */
export function buildSuggestPrompt(question, { facts = [], ruledOut = [], n = 10 } = {}) {
  const catalog = relevantCatalog(question, facts).map((a) => `- ${a.fluent}   (${a.reads})`).join('\n');
  const system = [
    'You turn a request in plain English into Smith Atomic English sentences: chains of calls like list(xs).joins().with(sep).',
    'Use the names the request uses for its inputs as the arguments. Prefer the catalog sentences below exactly as written, with the arguments renamed; otherwise use one of the shapes, with a new verb in a VERB slot if no known verb fits.',
    'Different sentences should do different things where the request is ambiguous, so the person can be asked which one they mean.',
    'Reply with one JSON object only: {"sentences": ["...", ...]}.',
    SHAPES_SECTION,
    'Catalog sentences that may fit (what each does in brackets):',
    catalog,
  ].join('\n');
  const user = [
    `Request: ${question}`,
    ...(facts.length ? ['The person confirmed:', ...facts.map((f) => `- ${f.given}, it should give ${f.output}`)] : []),
    ...(ruledOut.length ? ['These do something else; do not suggest them again:', ...ruledOut.map((s) => `- ${s}`)] : []),
    `Give ${n} different sentences, best first.`,
  ].join('\n');
  return { system, user };
}

function jsonFrom(text) {
  const s = String(text ?? '');
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  return JSON.parse(a >= 0 && b > a ? s.slice(a, b + 1) : s);
}

async function claudeJson(system, user, { model = 'haiku', run = runClaude } = {}) {
  const { stdout } = await run(claudeArgs({ model, system }), user, {});
  const out = JSON.parse(stdout);
  if (out.is_error) throw new Error(String(out.result).slice(0, 200));
  return jsonFrom(out.result);
}

/** Step 2: up to n candidate sentences for a request; `state` carries confirmed facts and ruled-out sentences. */
export function suggestSentences({ model, run } = {}) {
  return async (question, n, state = {}) => {
    const { system, user } = buildSuggestPrompt(question, { facts: state.facts, ruledOut: state.ruledOut, n });
    return (await claudeJson(system, user, { model, run })).sentences ?? [];
  };
}

/** Runs a checked option on readable case k (inputs named across all options); its outcome as words. */
export async function runOption(option, k, allOptions) {
  const inputs = uniqueInputs(allOptions);
  const values = readableCase(inputs, k);
  const r = await runAnswer(option.js, inputs.map((x) => x.name), inputs.map((x) => values[x.name]));
  return r.throws ? `an error (${r.throws.name})` : show(r.ok);
}

/** Case k in words: "With prices = [3,1,2]". */
export function givenText(allOptions, k) {
  const inputs = uniqueInputs(allOptions);
  const values = readableCase(inputs, k);
  return inputs.length ? `With ${inputs.map((x) => `${x.name} = ${show(values[x.name])}`).join(' and ')}` : 'With nothing given';
}

function uniqueInputs(options) {
  const seen = new Map();
  for (const o of options) for (const x of o.inputs ?? []) if (!seen.has(x.name)) seen.set(x.name, x);
  return [...seen.values()];
}

export const DRAFT_SYSTEM_LINES = [
  'A person asked for something no catalog sentence does, and gave one example of what should happen.',
  'Write one new Atomic English sentence for it in one of the shapes below (a new third-person verb such as copies may fill a VERB slot), the plain JS it stands for, and the example as data.',
  'Reply with one JSON object only: {"sentence": "...", "js": "...", "example": {"inputs": {"<name>": <value>}, "output": <value>}}. The js is one expression over the input names.',
  SHAPES_SECTION,
];
export const DRAFT_SYSTEM = DRAFT_SYSTEM_LINES.join('\n');

/** Step 5's drafter: returns the sentence and keeps the JS and parsed example for the check. */
export function draftSentence({ model = 'opus', run } = {}) {
  const drafts = new Map();
  const draft = async (question, example) => {
    const d = await claudeJson(DRAFT_SYSTEM, `Request: ${question}\nTheir example, in their words: ${example}`, { model, run });
    drafts.set(d.sentence, d);
    return d.sentence;
  };
  const check = (sentence) => {
    const d = drafts.get(sentence);
    return d ? checkSentence(sentence, { js: d.js, example: d.example }) : checkSentence(sentence);
  };
  return { draft, check };
}
