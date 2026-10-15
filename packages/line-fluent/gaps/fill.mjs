// Filling a gap (owner, 2026-10-15): toAtoms reports code no atom is for (`groups.set(key, [opp])` on a Map); this
// makes the atom, so it can be registered and found next time. Everything but the words is known from the code:
//
//   static     js, params and kind come from the gap and its reference entry (map.set(key, value), a map, in place)
//   words      a model suggests sentences only (it guesses synonyms; it never decides)
//   gate       each sentence, with the static js and params, goes through the full C3 gate
//   read-back  a second model call sees only the sentence and a readable input, never the js, and says what comes out,
//              what changes, and what it would call the step; the sentence is a replacement only when that matches
//              what the code really does
//
// Survivors go to the person for the wording (clarify, words only); their choice is approved into line-smith's
// approved.json and gen-atoms regenerates the catalog.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { runAnswer } from '../gate/equivalence/equivalence.mjs';
import { checkGrammar } from '../gate/grammar/grammar.mjs';
import { SHAPES_SECTION } from '../pilot/request/request.mjs';
import { claudeArgs, runClaude } from '../pilot/runner/claude-model.mjs';
import { show } from '../clarify/sentences.mjs';

const REFERENCE = fileURLToPath(new URL('../../line-codemod/bench/atoms/js-reference/reference.json', import.meta.url));

/** The receiver's parameter name and generator per type the code shows. */
// The receiver's name is short and is never a subject word, so `map(m)` cannot become `list(map)`.
const RECEIVER = { map: ['m', 'map'], weakmap: ['wm', 'weakmap'], set: ['s', 'set'], list: ['xs', 'list'], text: ['t', 'text'], date: ['d', 'date'] };
/** The subject word a sentence about each type starts with (R2). */
const SUBJECT = { map: 'map', set: 'set', list: 'list', text: 'text', date: 'date', weakmap: 'map' };
/** Readable receivers, as a person reads them. */
const READABLE_RECEIVER = { map: () => new Map([['pen', 2]]), set: () => new Set(['pen']), list: () => [3, 1, 2], text: () => 'Hello world', date: () => new Date('2026-01-15T00:00:00Z') };
const READABLE_ARG = ['bag', 30, 'cup'];
/** Members that change their receiver in place. */
const IN_PLACE = new Set(['set', 'delete', 'add', 'clear', 'push', 'pop', 'shift', 'unshift', 'splice', 'sort', 'reverse', 'fill', 'copyWithin']);
/** A TS parameter type as a generator name. */
const genOf = (type) => (/^number\b/.test(type) ? 'num' : /^string\b/.test(type) ? 'text' : /^boolean\b/.test(type) ? 'bool' : /\[\]$|^Array</.test(type) ? 'list' : /=>|Function/.test(type) ? 'fn' : 'prim');

/**
 * The atom a gap needs, built from the code alone: its js, params (receiver first) and kind.
 * @param {{type: string, member: string, entry: string}} gap A gap from toAtoms.
 * @returns {{entry: object, js: string, params: [string, string][], kind: string}} The static atom.
 */
export function staticAtom(gap, { reference = JSON.parse(readFileSync(REFERENCE, 'utf8')).entries } = {}) {
  const entry = reference.find((e) => e.key === gap.entry);
  if (!entry) throw new Error(`No reference entry ${gap.entry}.`);
  const [recv, recvGen] = RECEIVER[gap.type] ?? [gap.type, 'prim'];
  const args = (entry.params ?? []).filter((p) => !p.optional && !p.rest);
  return {
    entry,
    js: `${recv}.${gap.member}(${args.map((p) => p.name).join(', ')})`,
    params: [[recv, recvGen], ...args.map((p) => [p.name, genOf(p.type)])],
    kind: IN_PLACE.has(gap.member) ? 'in-place' : 'value',
  };
}

/** The C2 answer for a sentence over the static atom; the atom's name follows R8 (the words after the subject). */
export function answerFor(atom, sentence) {
  const words = sentence.replace(/\([^()]*\)/g, '').split('.').filter(Boolean);
  const after = words.slice(1);
  const name = after.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1) : w)).join('');
  return { entry: atom.entry.id, decision: 'new-atom', atom: name, existing: null, kind: atom.kind, sentence, js: atom.js, params: atom.params, parts: null, reason: null };
}

/** Runs the static js on readable inputs: what a person is shown, and what the read-back is compared with. */
export async function readableRun(atom, gapType) {
  const names = atom.params.map(([n]) => n);
  const values = [READABLE_RECEIVER[gapType]?.() ?? READABLE_ARG[0], ...atom.params.slice(1).map((_, i) => READABLE_ARG[i])];
  // Described before the run: a map prints as {} in JSON, so changes are compared on the readable form.
  const before = values.map((v) => describe(show(v), v));
  const r = await runAnswer(atom.js, names, values);
  const after = values.map((v) => describe(show(v), v));
  return {
    subject: SUBJECT[gapType] ?? null,
    given: names.map((n, i) => `${n} = ${before[i]}`).join(', '),
    gives: r.throws ? `an error (${r.throws.name})` : describe(show(r.ok), r.ok),
    changed: names.map((n, i) => (after[i] !== before[i] ? `${n} becomes ${after[i]}` : null)).filter(Boolean),
  };
}

/** Maps and sets as people write them: map {"pen" → 2}. */
function describe(text, v) {
  if (v instanceof Map) return `a map {${[...v].map(([k, x]) => `${JSON.stringify(k)} → ${JSON.stringify(x)}`).join(', ')}}`;
  if (v instanceof Set) return `a set {${[...v].map((x) => JSON.stringify(x)).join(', ')}}`;
  return text;
}

async function claudeJson(system, user, { model = 'haiku', run = runClaude } = {}) {
  const { stdout } = await run(claudeArgs({ model, system }), user, {});
  const out = JSON.parse(stdout);
  if (out.is_error) throw new Error(String(out.result).slice(0, 200));
  const t = String(out.result);
  return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
}

/** Words only: n sentences for the static atom, from a prompt built for this gap. */
export async function suggestWords(atom, example, { n = 10, model = 'haiku', run } = {}) {
  const system = [
    'You write Smith Atomic English sentences: chains of calls like list(xs).joins().with(sep). Reply with one JSON object only: {"sentences": ["...", ...]}.',
    'Use the parameter names as the arguments. A new third-person verb (sets, removes) may fill a VERB slot.',
    SHAPES_SECTION,
  ].join('\n');
  const user = [
    `The step: ${atom.js} (${atom.kind === 'in-place' ? 'it changes its first input in place' : 'it changes nothing'}).`,
    `Parameters: ${atom.params.map(([p]) => p).join(', ')}.${example.subject ? ` Start the sentence with the subject ${example.subject}(${atom.params[0][0]}); every other argument is carried by a role word such as at, to, with, by, from (R3), and the verb takes no argument of its own.` : ''}`,
    `Example: with ${example.given}, it gives ${example.gives}${example.changed.length ? ` and ${example.changed.join(', ')}` : ''}.`,
    `Give ${n} different sentences that say exactly this, best first.`,
  ].join('\n');
  return (await claudeJson(system, user, { model, run })).sentences ?? [];
}

/**
 * The read-back: a model that sees only the sentence and a readable input says what comes out, what changes, and
 * what it would call the step. The sentence can replace the code only when that matches the real run.
 */
export async function readBack(sentence, atom, example, { model = 'haiku', run } = {}) {
  const names = atom.params.map(([n]) => n);
  const system = [
    'You read one sentence that describes a step in a program and say what the step does on an example. You are not shown any code.',
    'Reply with one JSON object only: {"gives": "...", "changes": "<input name or none>", "becomes": "<its new value, or none>", "name": "..."}.',
    `gives: the value that comes out. changes: exactly one of ${names.map((n) => `"${n}"`).join(', ')} or "none". becomes: that input's new value, written the way the inputs are written. name: what you would call this step, in a few plain words.`,
  ].join('\n');
  const user = `Sentence: ${sentence}\nInputs: ${example.given}`;
  const said = await claudeJson(system, user, { model, run });
  const real = { gives: example.gives, changes: example.changed.map((c) => c.split(' becomes ')[0]), becomes: example.changed.map((c) => c.split(' becomes ')[1]) };
  return { said, real };
}

const flat = (s) => String(s ?? '').toLowerCase().replace(/^a (map|set) /, '').replace(/\s+/g, '').replace(/(=>|->|:)/g, '→');

/**
 * Judges a read-back against the real run, with no model. The reader must name the input that really changes (or
 * none) and its new value; for a step that changes nothing, what comes out must match. An in-place step is judged on
 * its change only: nobody reads "sets" for what it returns.
 */
export function readBackMatches({ said, real }, atom) {
  const changed = String(said.changes ?? 'none').trim();
  const realChanged = real.changes[0] ?? 'none';
  if (changed !== realChanged) return { ok: false, why: `a reader would expect ${changed === 'none' ? 'nothing' : changed} to change, but ${realChanged === 'none' ? 'nothing changes' : `${realChanged} changes`}` };
  if (realChanged !== 'none' && flat(said.becomes) !== flat(real.becomes[0])) return { ok: false, why: `a reader would expect ${changed} to become ${said.becomes}, but it becomes ${real.becomes[0]}` };
  if (atom.kind !== 'in-place' && flat(said.gives) !== flat(real.gives)) return { ok: false, why: `a reader would expect it to give ${said.gives}, but it gives ${real.gives}` };
  return { ok: true, name: said.name };
}

/** Every candidate sentence for a gap: grammar, gate and read-back, each with its verdict. */
export async function fillGap(gap, { gate, n = 10, model = 'haiku', run } = {}) {
  const atom = staticAtom(gap);
  const example = await readableRun(atom, gap.type);
  const sentences = [...new Set(await suggestWords(atom, example, { n, model, run }))].slice(0, n);
  const out = [];
  for (const sentence of sentences) {
    const grammar = checkGrammar({ sentence });
    if (grammar.check !== 'pass') {
      out.push({ sentence, ok: false, why: grammar.errors[0] });
      continue;
    }
    const answer = answerFor(atom, sentence);
    const verdict = gate ? await gate(answer) : { pass: true };
    if (!verdict.pass) {
      out.push({ sentence, ok: false, why: verdict.refusal });
      continue;
    }
    const rb = await readBack(sentence, atom, example, { model, run });
    const judged = readBackMatches(rb, atom);
    out.push({ sentence, answer, grammar, readBack: rb.said, ok: judged.ok, why: judged.why ?? null, name: judged.name ?? null });
  }
  return { gap, atom, example, candidates: out };
}
