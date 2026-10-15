// The 7b as a chain of small task steps instead of one answer call (owner, 2026-10-15: "break one internal model into
// a task specific model chain with scratch pads and a shared scratchpad", reusing jev / semif). One entry at a time:
//
//   decide   jev letter pick (@mx/reason calibratedChoice over @mx/seraph semanticIf): reuse a candidate atom, write a new
//            sentence, or say it cannot be said. Reuse is finished by code from the catalog.
//   frame    js and params: from the reference entry by rule (build.mjs staticAtom) when it can, else one small
//            schema-held proposal from the model ({js, params}, params typed by the gate's generator names).
//   shape    jev letter pick among at most 5 sentence shapes (one letter question, no second round) that start from
//            the receiver's subject and carry exactly as many arguments as the params (shortest first).
//   verb     one schema-held proposal: the third-person verb for the shape's VERB slot.
//   code     fills the shape, adds the R10 ending, the atom name (R8) and the kind; tidy, then the C3 gate.
//
// Each step reads its own scratchpad and the section's shared one (scratchpad.mjs) and writes back how it went, so the
// next entry of the section starts from what passed. Speed (owner, 2026-10-15, after 57x slower than one call): every
// prompt is fixed instructions first, then the pads, then the entry, so llama-server's prompt cache keeps the fixed
// part (and the pads while they are unchanged); a pick is rotated only when its first read is a close call; each
// result's `chain.perStep` records the model calls and milliseconds of every step. Rules-only fallback: with no picker every pick is the static
// order's first option; with no proposer a step that needs one ends the entry as not-expressible, saying why.
import { readFileSync } from 'node:fs';
import { SHAPES } from '../gate/grammar/shapes.mjs';
import { fill, staticAtom, shortestShapes, SUBJECT_OF_GEN, atomName } from '../pilot/build/build.mjs';
import { withReturn } from '../../line-smith/scripts/lib-return.mjs';
import { gens } from '../../line-smith/test/support/gens.mjs';
import { tidyAnswer } from '../contract/tidy.mjs';

const RETURN_NAMES = JSON.parse(readFileSync(new URL('../../line-smith/src/atoms/naming.json', import.meta.url), 'utf8')).grammar.returnNames;
export const ROLES = ['decide', 'frame', 'shape', 'verb'];
/** One jev letter question holds at most 5 options (@mx/seraph SEMIF_MAX_OPTIONS): the shape pick is one round. */
export const MAX_SHAPES = 5;
export const PICK_MARGIN = 0.3;
const GEN_NAMES = Object.keys(gens);

export const FRAME_SCHEMA = {
  type: 'object',
  properties: {
    js: { type: 'string' },
    params: { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, type: { enum: GEN_NAMES } }, required: ['name', 'type'], additionalProperties: false } },
  },
  required: ['js', 'params'],
  additionalProperties: false,
};
export const VERB_SCHEMA = { type: 'object', properties: { verb: { type: 'string', pattern: '^[a-z]+s$' } }, required: ['verb'], additionalProperties: false };

const one = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const argsOf = (shape) => shape.split('.').filter((t) => t.endsWith('(·)')).length;
const describe = (entry) => [
  'This entry:',
  `Entry: ${entry.id} (${entry.kind} in ${entry.section})`,
  `Params: ${(entry.params ?? []).map((p) => `${p.rest ? '...' : ''}${p.name}${p.optional ? '?' : ''}: ${p.type}`).join(', ') || '(none)'}`,
].join('\n');
const padsText = (...pads) => pads.map((p) => p.text()).filter(Boolean).join('\n');

/** The shapes an atom with these params can take, likeliest first: shortest paths from its subject, then the rest. */
export function shapeChoices(params, { limit = MAX_SHAPES } = {}) {
  const n = params.length;
  const subject = SUBJECT_OF_GEN[params[0]?.[1]];
  const shortest = subject ? shortestShapes(subject, n, { limit }).shapes.map((s) => s.join('.')) : [];
  const fits = [...SHAPES.keys()].filter((s) => argsOf(s) === n);
  const own = (s) => subject && (s.startsWith(`${subject}(·)`) || s.startsWith(`clones().${subject}(·)`));
  return [...new Set([...shortest, ...fits.filter(own), ...fits.filter((s) => !own(s))])].slice(0, limit);
}

const kindOf = (shape, frame) => (shape.startsWith('checks()') ? 'question' : shape.startsWith('clones()') ? 'copy' : frame.kind ?? 'value');

/**
 * Parses a schema-held proposal; null when it cannot be read.
 * @returns {Promise<{value: object|null, tokensIn: number, tokensOut: number}>}
 */
async function proposeJson(propose, system, user, schema) {
  const reply = await propose({ system, user, prefill: '', schema });
  let value = null;
  try { value = JSON.parse(reply?.text ?? ''); } catch { /* unreadable: null */ }
  return { value, tokensIn: reply?.tokensIn ?? 0, tokensOut: reply?.tokensOut ?? 0 };
}

export const FRAME_SYSTEM = [
  'Write the plain JavaScript call that one JavaScript reference entry stands for, and its parameters.',
  'js: one short expression using the parameter names, for example xs.at(index) or Array.from(items).',
  'params: every name the js uses that is not defined inside it, the receiver first, each typed by one test generator name.',
  `Test generator names: ${GEN_NAMES.join(', ')}`,
  'Reply with one JSON object: {"js": "...", "params": [{"name": "...", "type": "..."}]}.',
].join('\n');
export const VERB_SYSTEM = [
  'Choose the verb for a Smith Atomic English sentence: one third-person verb (sorts, trims, copies) that says plainly what the step does.',
  'The verb goes in the VERB slot of the given sentence pattern. Reply with one JSON object: {"verb": "..."}.',
].join('\n');
/** The fixed head of each role's letter question; the pads and the entry come after it. */
export const PICK_HEADS = {
  decide: 'You are the decide step of a chain that writes Smith Atomic English sentences for JavaScript reference entries. Notes from earlier entries, then the entry:',
  shape: 'You are the shape step of a chain that writes Smith Atomic English sentences for JavaScript reference entries. Notes from earlier entries, then the entry and its JavaScript:',
};

/**
 * One entry through the chain.
 * @param {{entry: object, candidates: object[], refusal?: string|null}} item
 * @param {{pick?: (choices: string[], words: string, fact: string, question: string) => Promise<number>,
 *          propose?: Function, gateOf: Function, pads: ReturnType<import('./scratchpad.mjs').padBoard>}} deps
 */
export async function chainAnswer(item, { pick, propose, gateOf, pads }) {
  const { entry, candidates = [], refusal = null } = item;
  const p = pads.of(entry.section);
  const trace = { steps: [], picks: 0, proposals: 0, rotated: 0, calls: 0, ms: 0, perStep: {} };
  let tokensIn = 0;
  let tokensOut = 0;
  const count = (role, calls, ms) => {
    const s = (trace.perStep[role] ??= { calls: 0, ms: 0 });
    s.calls += calls;
    s.ms += ms;
    trace.calls += calls;
    trace.ms += ms;
  };
  const choose = async (role, choices, words, question) => {
    if (choices.length < 2 || !pick) return 0;
    trace.picks += 1;
    const t0 = performance.now();
    const r = await pick(choices, words, `line.chain.${role}`, question, { head: PICK_HEADS[role] });
    const read = typeof r === 'number' ? { index: r, calls: 1 } : r;
    if (read.rotated) trace.rotated += 1;
    count(role, read.calls ?? 1, Math.round(performance.now() - t0));
    return read.index ?? 0;
  };
  const ask = async (role, system, user, schema) => {
    trace.proposals += 1;
    const t0 = performance.now();
    const r = await proposeJson(propose, system, user, schema);
    count(role, 1, Math.round(performance.now() - t0));
    tokensIn += r.tokensIn;
    tokensOut += r.tokensOut;
    return r;
  };
  // Pads before the entry: the fixed instructions (system / pick head) and then the pads are a prefix many prompts share.
  const context = (role) => [padsText(p.shared, p[role]), describe(entry), refusal ? `The last answer was refused: ${refusal}` : ''].filter(Boolean).join('\n');
  const finish = async (answer, why) => {
    const { answer: tidy, tidied } = tidyAnswer(answer, { candidates });
    const gate = await gateOf(entry)(tidy);
    const outcome = gate.pass ? 'pass' : 'refused';
    if (gate.pass && tidy.decision !== 'not-expressible') p.shared.add(tidy.decision, `${tidy.sentence} = ${tidy.js}`, 'pass');
    else if (!gate.pass) p.shared.add('refusal', `${entry.id}: ${one(gate.refusal).slice(0, 140)}`, 'refused');
    for (const s of trace.steps) p[s.role]?.add(s.tag, s.note, outcome);
    return { answer: tidy, gate, ...(tidied.length ? { tidied } : {}), chain: { ...trace, why }, tokensIn, tokensOut, costUsd: 0 };
  };
  const cannot = (reason) => finish({ entry: entry.id, decision: 'not-expressible', atom: null, existing: null, kind: null, sentence: null, js: null, params: [], parts: null, reason }, reason);

  // 1. decide. After a not-expressible refusal, "cannot" is no longer offered.
  const reuse = candidates.slice(0, 3);
  const dodged = /not-expressible/.test(refusal ?? '');
  const choices = [...reuse.map((c) => `reuse ${c.atom}: ${c.fluent}`), 'write a new sentence for it', ...(dodged ? [] : ['it cannot be said as a sentence'])];
  const d = await choose('decide', choices, context('decide'), 'What should the answer for this entry do?');
  trace.steps.push({ role: 'decide', tag: choices[d].split(':')[0], note: `${entry.id}: ${choices[d]}` });
  if (d < reuse.length) {
    const c = reuse[d];
    return finish({ entry: entry.id, decision: 'existing', atom: null, existing: c.atom, kind: 'value', sentence: null, js: null, params: [], parts: null, reason: null }, `reuses ${c.atom}`);
  }
  if (choices[d].startsWith('it cannot')) return cannot(`The picker found no sentence for ${entry.id}.`);

  // 2. frame: js and params.
  let frame = staticAtom(entry);
  if (frame) trace.steps.push({ role: 'frame', tag: 'rule', note: `${entry.id}: ${frame.js} by rule` });
  else {
    if (!propose) return cannot(`No rule gives the JavaScript for ${entry.id}, and no model is running to propose it.`);
    const r = await ask('frame', FRAME_SYSTEM, context('frame'), FRAME_SCHEMA);
    const params = (r.value?.params ?? []).filter((x) => x?.name && GEN_NAMES.includes(x.type)).map((x) => [x.name, x.type]);
    if (!r.value?.js || !params.length) return cannot(`The model gave no readable JavaScript and params for ${entry.id}.`);
    frame = { js: one(r.value.js), params, kind: 'value', member: null };
    trace.steps.push({ role: 'frame', tag: 'proposed', note: `${entry.id}: ${frame.js} with ${params.map(([n, t]) => `${n}:${t}`).join(', ')}` });
  }

  // 3. shape.
  const shapes = shapeChoices(frame.params);
  if (!shapes.length) return cannot(`No sentence shape carries ${frame.params.length} argument${frame.params.length === 1 ? '' : 's'}.`);
  const s = await choose('shape', shapes.map((x) => SHAPES.get(x)), `${context('shape')}\nJavaScript: ${frame.js}`, 'Which sentence pattern says what this JavaScript does?');
  const shape = shapes[s];
  trace.steps.push({ role: 'shape', tag: shape, note: `${frame.js}: ${shape}` });

  // 4. verb (only for a shape with a VERB slot).
  let verb = null;
  if (shape.includes('VERB')) {
    if (!propose) return cannot(`The shape ${shape} needs a verb and no model is running to propose it.`);
    const r = await ask('verb', VERB_SYSTEM, `${context('verb')}\nJavaScript: ${frame.js}\nSentence pattern: ${shape}   e.g. ${SHAPES.get(shape)}`, VERB_SCHEMA);
    verb = /^[a-z]+s$/.test(r.value?.verb ?? '') ? r.value.verb : null;
    if (!verb) return cannot(`The model gave no third-person verb for ${entry.id}.`);
    trace.steps.push({ role: 'verb', tag: verb, note: `${frame.js}: ${verb}` });
  }

  // 5. code assembles the answer.
  const sentence = withReturn(fill(shape.split('.'), verb, frame.params.map(([n]) => n)), RETURN_NAMES);
  return finish({ entry: entry.id, decision: 'new-atom', atom: atomName(sentence), existing: null, kind: kindOf(shape, frame), sentence, js: frame.js, params: frame.params, parts: null, reason: null }, `new atom on ${shape}`);
}

/** A chain turn with answerTurn's result shape: every item through the chain, side by side. */
export function chainTurn(items, deps) {
  return Promise.all(items.map((it) => chainAnswer(it, deps)));
}

/** The calibrated probabilities' lead of the best choice over the runner-up. */
const marginOf = (probs) => {
  const [a = 0, b = 0] = [...probs].sort((x, y) => y - x);
  return a - b;
};

/**
 * The picker the chain uses: one jev calibrated letter question (@mx/reason calibratedChoice, at most 5 options, no
 * second round) asked through @mx/seraph's semanticIf on a semif model. Rotated (each choice in each letter slot, so
 * jev's lean to letter A cancels) only when the first read is a close call: its margin is under seraph's SEMIF_MARGIN.
 * Resolves {index, calls, rotated, margin}; null when either link is missing (the chain then keeps the rules order).
 */
export async function linkedPicker(semifModel, { importLinked } = {}) {
  const load = importLinked ?? (await import('../../line-links/index.mjs')).importLinked;
  const [reason, seraph] = await Promise.all([load('@mx/reason'), load('@mx/seraph')]);
  if (!('module' in reason) || !('module' in seraph)) return null;
  const closeAt = seraph.module.SEMIF_MARGIN ?? PICK_MARGIN;
  const most = seraph.module.SEMIF_MAX_OPTIONS ?? MAX_SHAPES;
  const { calibratedChoice } = reason.module;
  return async (all, words, fact, question, { head = '' } = {}) => {
    const choices = all.slice(0, most);
    let calls = 0;
    const ask = async (q) => {
      const r = await seraph.module.semanticIf(semifModel, q);
      calls += r?.mode === 'constrained' ? 2 : 1;
      return r;
    };
    const frame = { fact, state: (w) => (head ? `${head}\n${w}` : w), question };
    const first = await calibratedChoice(ask, frame, words, choices);
    let probs = [...first];
    const margin = marginOf(first);
    const rotated = margin < closeAt && choices.length > 1;
    if (rotated) {
      // The other cyclic rotations, each one plain question; averaged with the first read in the original order.
      const n = choices.length;
      const reads = await Promise.all(choices.slice(1).map(async (_, k) => {
        const order = choices.map((__, at) => (at + k + 1) % n);
        return { order, p: await calibratedChoice(ask, frame, words, order.map((i) => choices[i])) };
      }));
      for (const { order, p } of reads) for (const [slot, i] of order.entries()) probs[i] += p[slot] ?? 0;
      probs = probs.map((v) => v / n);
    }
    let index = 0;
    for (const [i, v] of probs.entries()) if (v > probs[index]) index = i;
    return { index, calls, rotated, margin: Math.round(margin * 1e4) / 1e4 };
  };
}
