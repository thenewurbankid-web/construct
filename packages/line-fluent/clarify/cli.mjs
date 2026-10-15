// Clarify a sentence with a person, one turn at a time (state kept in a JSON file between turns):
//
//   node packages/line-fluent/clarify/cli.mjs start "<what the person wants>" --state s.json [--model haiku] [--n 10]
//   node packages/line-fluent/clarify/cli.mjs answer "<their reply>" --state s.json [--draft-model opus]
//
// start: the model suggests n sentences (prompt built for this request), each is built into its atom and tested
// statically, and the first question is printed. answer: the reply narrows the options (narrow.mjs) and the next
// question is printed, until the person confirms one sentence (printed as "Agreed sentence: ...") or nothing fits,
// when a new sentence is drafted from what they confirmed and must reproduce it before it is offered back.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { nextQuestion, applyAnswer } from './narrow.mjs';
import { checkSentence, dedupeOptions, suggestSentences, runOption, givenText, readableCase, show, DRAFT_SYSTEM } from './sentences.mjs';
import { claudeArgs, runClaude } from '../pilot/runner/claude-model.mjs';
import { runAnswer } from '../gate/equivalence/equivalence.mjs';
import { checkGrammar } from '../gate/grammar/grammar.mjs';

const how = { run: (o, k) => runOption(o, k, CURRENT.all), given: (os, k) => givenText(CURRENT.all, k) };
const CURRENT = { all: [] };

async function start(question, { model = 'haiku', n = 10 }) {
  const suggestions = await suggestSentences({ model })(question, n, {});
  const checked = [];
  for (const answer of [...new Set(suggestions)].slice(0, n)) checked.push({ answer, ...(await checkSentence(answer)) });
  const options = dedupeOptions(checked.filter((c) => c.ok));
  const state = { question, options, all: options, facts: [], ruledOut: [], refused: checked.filter((c) => !c.ok), pending: null };
  return ask(state);
}

async function ask(state) {
  CURRENT.all = state.all;
  const q = await nextQuestion(state, how);
  state.pending = q;
  return { state, say: q.text };
}

/** Step 5: a new sentence drafted from the person's facts; it must reproduce every fact given on a readable case. */
async function create(state, { draftModel = 'opus' }) {
  const facts = state.facts.map((f) => `${f.given}, it should give ${f.output}`).join('\n');
  const names = (state.all.flatMap((o) => o.inputs ?? []).map((x) => x.name)).filter((v, i, a) => a.indexOf(v) === i);
  const user = `Request: ${state.question}\nInputs, by name: ${names.join(', ') || '(choose names)'}\nWhat the person confirmed:\n${facts || '(nothing yet)'}`;
  const { stdout } = await runClaude(claudeArgs({ model: draftModel, system: DRAFT_SYSTEM }), user, {});
  const out = JSON.parse(stdout);
  const text = String(out.result);
  const d = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  const grammar = checkGrammar({ sentence: d.sentence });
  if (grammar.check !== 'pass') return { state, say: `I could not write that as a sentence that reads right (${grammar.errors[0]}). Could you say once more what it should do?` };
  const inputs = state.all.flatMap((o) => o.inputs ?? []).filter((x, i, a) => a.findIndex((y) => y.name === x.name) === i);
  for (const f of state.facts.filter((x) => x.case !== null && x.case !== undefined)) {
    const values = readableCase(inputs, f.case);
    const r = await runAnswer(d.js, inputs.map((x) => x.name), inputs.map((x) => values[x.name]));
    const got = r.throws ? `an error (${r.throws.name})` : show(r.ok);
    if (got !== f.output) return { state, say: `${f.given}, my new one gives ${got}, not ${f.output}. Could you give one more example of what should happen?` };
  }
  const created = { answer: d.sentence, plain: d.sentence, js: d.js, inputs, created: true, aliases: grammar.aliases ?? [] };
  const next = { ...state, options: [created], all: [created] };
  return ask(next);
}

export async function main(argv = process.argv.slice(2), { log = console.log } = {}) {
  const { values: o, positionals } = parseArgs({ args: argv, allowPositionals: true, options: { state: { type: 'string' }, model: { type: 'string' }, 'draft-model': { type: 'string' }, n: { type: 'string' } } });
  const [cmd, text] = positionals;
  if (!o.state || !['start', 'answer'].includes(cmd) || !text) throw new Error('Usage: cli.mjs start "<request>" | answer "<reply>" --state <file>');
  let result;
  if (cmd === 'start') {
    result = await start(text, { model: o.model ?? 'haiku', n: Number(o.n ?? 10) });
  } else {
    const state = JSON.parse(readFileSync(o.state, 'utf8'));
    CURRENT.all = state.all;
    const applied = applyAnswer(state, state.pending, text);
    if (applied.again) result = { state, say: applied.again };
    else if (applied.done?.status === 'chosen') {
      const s = applied.done.option;
      result = { state: { ...applied.state, agreed: s, pending: null }, say: `Agreed sentence: ${s.answer}${s.created ? ` (new; adds the verb ${(s.aliases ?? []).map((a) => a.word).join(', ') || 'none'}; JS: ${s.js})` : ` (atom ${s.atom}; JS: ${s.js})`}` };
    } else if (applied.done?.status === 'create') result = await create(applied.state, { draftModel: o['draft-model'] ?? 'opus' });
    else result = await ask(applied.state);
  }
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
