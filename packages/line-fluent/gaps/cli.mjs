// Gaps to atoms, one turn at a time (state in a JSON file):
//
//   node packages/line-fluent/gaps/cli.mjs scan <file.js> --state g.json [--model haiku]
//   node packages/line-fluent/gaps/cli.mjs choose <number | your own word> --state g.json
//
// scan: toAtoms finds the code no atom is for; for the first gap, fill.mjs builds the atom from the code, a model
// suggests sentences, and the gate and read-back keep the ones that say what the code does. The wording question is
// printed. choose: the person's pick (or their own word, re-checked by the grammar and a read-back) is approved into
// line-smith's approved.json, gen-atoms regenerates the catalog, and toAtoms runs on the file again to show the gap
// is closed.
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { fillGap, answerFor, readBack, readBackMatches } from './fill.mjs';
import { withVerb } from '../clarify/sentences.mjs';
import { parse } from '../../line-smith/scripts/lib-sentence.mjs';
import { claudeArgs, runClaude } from '../pilot/runner/claude-model.mjs';
import { checkGrammar } from '../gate/grammar/grammar.mjs';
import { gateFor } from '../pilot/library/run.mjs';
import { makeTypesCheck } from '../gate/types/types.mjs';
import { approveProposal, approvedEntry, writeProposal, REFERENCE_PATH, CATALOG_PATH, GEN_ATOMS_PATH } from '../generator/generator.mjs';

const require = createRequire(import.meta.url);
const reference = () => JSON.parse(readFileSync(REFERENCE_PATH, 'utf8')).entries;

/** toAtoms on a file against the current catalog (loaded fresh, so a just-registered atom is seen). */
export function gapsIn(file) {
  const codemod = fileURLToPath(new URL('../../line-codemod/', import.meta.url));
  for (const k of Object.keys(require.cache)) if (k.startsWith(codemod)) delete require.cache[k];
  const { toAtoms } = require('../../line-codemod/atoms-transform.js');
  const { loadCatalog } = require('../../line-codemod/atoms-catalog.js');
  const code = readFileSync(file, 'utf8').replace(/^export /gm, '');
  return toAtoms(code, { catalog: loadCatalog(CATALOG_PATH) });
}

/** The kept candidates, one per verb: the options only differ in the word for what the step does. */
function byVerb(state) {
  const out = [];
  for (const c of state.candidates.filter((x) => x.ok)) {
    const verb = parse(c.sentence)[1]?.word;
    if (verb && !out.some((o) => o.verb === verb)) out.push({ ...c, verb });
  }
  return out;
}

/** The step in plain words, from its readable run: "The map has pen → 2. After this step, it has pen → 2 and bag → 30." */
function plainStep(state) {
  const ex = state.example;
  const kind = { map: 'a map (a list of names, each with a value)', set: 'a set', list: 'a list', text: 'a piece of text' }[state.gap.type] ?? 'a value';
  const values = ex.given.split(', ').slice(1).map((g) => g.split(' = ')[1]).join(' and ');
  const before = ex.given.split(', ')[0].split(' = ')[1].replace(/^a map /, '');
  const after = (ex.changed[0] ?? '').split(' becomes ')[1]?.replace(/^a map /, '');
  return `One step in your code changes ${kind}. For example, the map has ${before}; the step is given ${values}; afterwards the map has ${after}.`;
}

export function question(state) {
  const options = byVerb(state).map((c, i) => `  ${i + 1}. ${state.plain?.[c.verb] ?? c.verb}`).join('\n');
  return `${plainStep(state)}\nWhich of these says best what it does?\n${options}\nOr say it in your own words.`;
}

// ---- asking about the person's own code, one guess at a time ---------------------------------

/** How sure the step's meaning must be before it is settled. */
export const SETTLED = 0.8;

/**
 * One turn of inference, by the outer model: it re-reads the whole block and every answer so far, revises every
 * assumption (what the block does, what goes in and out, what each name means, what the unclear step does) with a
 * confidence, says whether the step is settled and which candidate word or own word it is, and picks the next
 * question: the one that would most improve the least certain assumption that matters for the step, in plain words.
 * Our code checks the result: a settled step needs confidence >= SETTLED and a real candidate or a plain word.
 */
export async function refine(state, source, { model = 'opus' } = {}) {
  const options = byVerb(state);
  const system = [
    'You help a person who does not read code confirm what their code does. You keep a list of assumptions about the code and improve every one of them each turn, using the code and everything the person has said.',
    'Read the whole block first: what it is for, in the terms of its own domain (its names), not data structures. Assumptions cover: what the block does, what goes in, what comes out, what each name means, and what the one unclear step does within the block.',
    'Give each assumption a confidence from 0 to 1. Something the person confirmed is near 1; something they contradicted is replaced.',
    'The step is settled only when you are confident what it does and it fits one of the candidate words (give its number) or a word the person used (give the verb, base form).',
    'Then choose the next question: the one whose answer would most improve the least certain assumption that matters for describing the step. Ask it in plain, friendly words, about the domain (opportunities, groups...), never about code. One question, answerable in a few words.',
    'Reply with one JSON object only: {"assumptions": [{"about": "block | inputs | output | name:<name> | step", "statement": "...", "confidence": <0..1>}], "step": {"meaning": "...", "confidence": <0..1>, "candidate": <number or null>, "word": "<verb or null>"}, "question": "..."}.',
  ].join('\n');
  const user = [
    `The code:\n${source}`,
    `The unclear step: ${state.gap.code}`,
    'Candidate words that passed every check (technical form):', ...options.map((o, i) => `${i + 1}. ${o.verb}: ${o.sentence}`),
    `Assumptions so far: ${JSON.stringify(state.assumptions ?? [])}`,
    'Conversation so far:', ...(state.history ?? []).map((h) => `Q: ${h.q}\nA: ${h.a}`),
  ].join('\n');
  const r = await claudeJson(system, user, model);
  const step = r.step ?? {};
  const n = Number(step.candidate);
  const candidate = Number.isInteger(n) && options[n - 1] ? options[n - 1] : null;
  const word = !candidate && typeof step.word === 'string' && /^[a-z]+$/i.test(step.word.trim()) ? step.word.trim().toLowerCase() : null;
  const settled = Number(step.confidence) >= SETTLED && Boolean(candidate || word);
  return {
    assumptions: Array.isArray(r.assumptions) ? r.assumptions : state.assumptions ?? [],
    step: { meaning: step.meaning ?? null, confidence: Number(step.confidence) || 0, verb: candidate?.verb ?? null, word },
    settled,
    question: typeof r.question === 'string' && r.question.trim() ? r.question.trim() : 'In your own words, what does this step do?',
  };
}

/** What the person reads each turn: the current reading of the code in one line, then the question. */
export function turnText(state) {
  const block = (state.assumptions ?? []).find((a) => a.about === 'block');
  return `${block ? `As I read it now: ${block.statement.replace(/\.$/, '')}.\n` : ''}${state.question}`;
}

// ---- the model as translator, both ways; our code checks every result ----------------

async function claudeJson(system, user, model) {
  const { stdout } = await runClaude(claudeArgs({ model, system }), user, {});
  const out = JSON.parse(stdout);
  if (out.is_error) throw new Error(String(out.result).slice(0, 200));
  const t = String(out.result);
  return JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1));
}

/**
 * Each option as one plain-English sentence with the example's real values ("It stores 30 under "bag" in the map.").
 * A sentence that lost its option's verb is replaced by the bare verb: the verb is the only thing the options differ in.
 */
export async function plainOptions(state, { model = 'haiku' } = {}) {
  const options = byVerb(state);
  const system = 'You turn short technical step descriptions into one plain, everyday English sentence each, for a person who does not read code. Use the example values, not variable names. Keep each step\'s own verb exactly (its base form or -s form). Reply with one JSON object only: {"sentences": ["...", ...]} in the same order.';
  const user = [`Example: ${state.example.given}; afterwards ${state.example.changed.join('; ') || 'nothing changes'}.`, 'Steps:', ...options.map((o, i) => `${i + 1}. ${o.sentence}`)].join('\n');
  const said = (await claudeJson(system, user, model)).sentences ?? [];
  const plain = {};
  options.forEach((o, i) => {
    const base = o.verb.replace(/(ies|es|s)$/, '');
    const text = String(said[i] ?? '').trim();
    plain[o.verb] = text && text.toLowerCase().includes(base.slice(0, Math.max(3, base.length - 1))) ? text : o.verb;
  });
  return plain;
}

/**
 * The person's reply, however it is put ("the second", "I'd say it saves it", "put"), as an option number or their
 * own word. The model only reads the reply; the number must exist and a new word is still checked by the grammar
 * and a read-back.
 */
export async function readReply(reply, state, { model = 'haiku' } = {}) {
  const text = String(reply).trim();
  if (/^\d+$/.test(text)) return { choice: Number(text), word: null };
  const options = byVerb(state);
  const system = 'A person was shown numbered options and answered in their own words. Work out what they chose. Reply with one JSON object only: {"choice": <option number or null>, "word": "<the one verb they want instead, base form, or null>"}. Use choice when they picked or described one of the options; use word only when they gave a different word of their own.';
  const user = [...options.map((o, i) => `${i + 1}. ${state.plain?.[o.verb] ?? o.sentence}`), `Their answer: ${text}`].join('\n');
  const r = await claudeJson(system, user, model);
  const choice = Number.isInteger(r.choice) && r.choice >= 1 && r.choice <= options.length ? r.choice : null;
  const word = !choice && typeof r.word === 'string' && /^[a-z]+$/i.test(r.word.trim()) ? r.word.trim().toLowerCase() : null;
  return { choice, word };
}

async function scan(file, { model, outer = 'opus' }) {
  const found = gapsIn(file).gaps.filter((g) => g.entry);
  if (!found.length) return { state: { file, gap: null }, say: 'No gaps: every part of this code has an atom for its type.' };
  const gap = found[0];
  const ref = reference();
  const gate = gateFor(ref.find((e) => e.key === gap.entry), { typesCheck: makeTypesCheck(ref) });
  const filled = await fillGap(gap, { gate, model });
  const state = { file, gap, atom: filled.atom, example: filled.example, candidates: filled.candidates, more: found.length - 1 };
  if (!filled.candidates.some((c) => c.ok)) return { state, say: `${plainStep(state)}\nNothing we tried describes it well. What would you call what it does?` };
  Object.assign(state, { history: [] }, await refine(state, readFileSync(file, 'utf8'), { model: outer }));
  return { state, say: turnText(state) };
}

async function choose(state, reply, { model, outer = 'opus' }) {
  const kept = byVerb(state);
  // Every answer goes back to the outer model, which revises every assumption and picks the next question.
  state = { ...state, history: [...(state.history ?? []), { q: state.question, a: String(reply) }] };
  Object.assign(state, await refine(state, readFileSync(state.file, 'utf8'), { model: outer }));
  if (!state.settled) return { state, say: turnText(state) };
  const read = { verb: state.step.verb, word: state.step.word };
  const text = read.word ?? '';
  let pick = read.verb ? kept.find((c) => c.verb === read.verb) : null;
  if (!pick && text && kept.length) {
    // The person's own word: the first kept sentence with their verb, checked by the grammar and a read-back.
    const sentence = withVerb(kept[0].sentence, text);
    const grammar = sentence ? checkGrammar({ sentence }) : null;
    if (!sentence || grammar.check !== 'pass') return { state, say: `“${text}” does not fit (${grammar ? grammar.errors[0] : 'one plain word, please'}). Pick a number, or another word.` };
    const judged = readBackMatches(await readBack(sentence, state.atom, state.example, { model }), state.atom);
    if (!judged.ok) return { state, say: `With “${text}”, ${judged.why}. Pick a number, or another word.` };
    pick = { sentence, answer: answerFor(state.atom, sentence), ok: true };
  }
  if (!pick) return { state, say: turnText(state) };

  // The pick becomes a pending proposal, approved into the registry; gen-atoms regenerates the catalog.
  const entry = reference().find((e) => e.key === state.gap.entry);
  const proposal = {
    version: 1, status: 'pending', entry: entry.id, key: entry.key, model: `gap:${model}+person`, createdAt: new Date().toISOString(),
    candidates: [], answer: pick.answer, gate: { entry: entry.id, pass: true, checks: { schema: 'pass', grammar: 'pass', equivalence: 'pass', types: 'pass' }, refusal: null, fixes: [] },
    tries: 1, adds: true, approvedEntry: approvedEntry(pick.answer, { entry }), catalogEntry: null,
    note: `From the gap \`${state.gap.code}\` (${state.gap.type}); wording confirmed by the person; read back as “${pick.name ?? 'their word'}”.`,
  };
  const file = writeProposal(proposal, mkdtempSync(join(tmpdir(), 'line-gap-')));
  approveProposal(file);
  execFileSync(process.execPath, [GEN_ATOMS_PATH], { stdio: 'pipe' });
  const after = gapsIn(state.file);
  const still = after.gaps.some((g) => g.entry === state.gap.entry);
  const used = Object.keys(after.atoms).includes(pick.answer.atom);
  return {
    state: { ...state, registered: pick.answer.atom, sentence: pick.sentence },
    say: `Registered the atom ${pick.answer.atom}: ${pick.sentence} (js: ${pick.answer.js}).\n${still ? 'toAtoms still reports this gap — check the catalog.' : `toAtoms now finds it: the gap is closed${used ? ` and ${state.file} uses ${pick.answer.atom}` : ''}.`}${state.more ? ` ${state.more} more gap(s) in this file; run scan again.` : ''}`,
  };
}

export async function main(argv = process.argv.slice(2), { log = console.log } = {}) {
  const { values: o, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { state: { type: 'string' }, model: { type: 'string', default: 'haiku' }, outer: { type: 'string', default: 'opus' } } });
  const [cmd, arg] = positionals;
  if (!o.state || !arg || !['scan', 'choose'].includes(cmd)) throw new Error('Usage: cli.mjs scan <file.js> | choose <number | word> --state <file>');
  const result = cmd === 'scan' ? await scan(arg, o) : await choose(JSON.parse(readFileSync(o.state, 'utf8')), arg, o);
  writeFileSync(o.state, `${JSON.stringify(result.state, null, 2)}\n`);
  log(result.say);
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
}
