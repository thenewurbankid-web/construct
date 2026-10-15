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
  const options = byVerb(state).map((c, i) => `  ${i + 1}. ${c.verb}`).join('\n');
  return `${plainStep(state)}\nWhich word describes what the step does?\n${options}\nOr tell me your own word.`;
}

async function scan(file, { model }) {
  const found = gapsIn(file).gaps.filter((g) => g.entry);
  if (!found.length) return { state: { file, gap: null }, say: 'No gaps: every part of this code has an atom for its type.' };
  const gap = found[0];
  const ref = reference();
  const gate = gateFor(ref.find((e) => e.key === gap.entry), { typesCheck: makeTypesCheck(ref) });
  const filled = await fillGap(gap, { gate, model });
  const state = { file, gap, atom: filled.atom, example: filled.example, candidates: filled.candidates, more: found.length - 1 };
  if (!filled.candidates.some((c) => c.ok)) return { state, say: `No sentence held up for \`${gap.code}\`. Tell me a word for what it does.` };
  return { state, say: question(state) };
}

async function choose(state, reply, { model }) {
  const kept = byVerb(state);
  const text = String(reply).trim();
  let pick = /^\d+$/.test(text) ? kept[Number(text) - 1] : null;
  if (!pick && /^[a-z]+$/i.test(text) && kept.length) {
    // The person's own word: the first kept sentence with their verb, checked by the grammar and a read-back.
    const sentence = withVerb(kept[0].sentence, text);
    const grammar = sentence ? checkGrammar({ sentence }) : null;
    if (!sentence || grammar.check !== 'pass') return { state, say: `“${text}” does not fit (${grammar ? grammar.errors[0] : 'one plain word, please'}). Pick a number, or another word.` };
    const judged = readBackMatches(await readBack(sentence, state.atom, state.example, { model }), state.atom);
    if (!judged.ok) return { state, say: `With “${text}”, ${judged.why}. Pick a number, or another word.` };
    pick = { sentence, answer: answerFor(state.atom, sentence), ok: true };
  }
  if (!pick) return { state, say: 'Answer with a number from the list, or one word of your own.' };

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
  const { values: o, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { state: { type: 'string' }, model: { type: 'string', default: 'haiku' } } });
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
