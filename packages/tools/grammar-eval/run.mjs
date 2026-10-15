#!/usr/bin/env node
// The grammar eval loop, end to end:
//
//   1. sweep   — every lexicon sentence (lint + read back + compile) and every
//                top-level declaration in the files (lint + gaps).
//   2. ask     — every user-domain name the mapper can only guess at, and every
//                statement that can't be said in one clean sentence (an atom),
//                as a plain-English question. The answerer is a small model
//                (--ask model: by default Claude Haiku through the `claude` CLI,
//                on the person's own Claude plan; --provider ollama for a local
//                qwen3:1.7b) or the person at the terminal (--ask user). Neither
//                ever sees code. A model gets up to --jobs questions per call
//                (default 10).
//   3. mark    — with --write, each accepted answer is written onto the
//                top-level function it describes as a `@does` marker, and each
//                atom is extracted into its own marked function — every atom
//                of one pass at once, then the file is re-planned.
//   4. re-sweep, and report coverage: the share of statements that read as
//                valid English. The goal is 100%; whatever is left is listed
//                with the reason a person is needed.
//
// Usage: node packages/tools/grammar-eval/run.mjs [--ask model|user] [--provider claude|ollama] [--model haiku]
//          [--write] [--limit N] [--jobs N] [paths...]
//
// Batch naming (--placeholders): every atom is extracted at once under a
// placeholder name, then all placeholders are named in one batch. Each entry
// shows its code, our English and suggested names (from the code's shape and,
// with --ask model, the model — which is given the English only). With
// --ask user the person picks per entry: a number, their own words, or Enter
// for the first option. With --sheet FILE the batch is written as JSON to fill
// in later; --apply-sheet FILE applies it.          (default path: packages/core)
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { evaluateLexicon, evaluateSource, findUserDomainGaps } from '../../core/grammar-eval.mjs';
import { correctGaps, markFunction, markerTypes, markersIn, batchPrompt, parseBatchReply, batchedAsker, DEFAULT_GRAMMAR_PROVIDER, DEFAULT_GRAMMAR_MODELS } from '../../core/corrections.mjs';
import { planAtoms, planAtomsInFiles, atomQuestion, nameFromAnswer, applyAtoms } from '../../core/atoms.mjs';
import { extractWithPlaceholders, namingSheet, optionsQuestion, parseOptions, applyNames } from '../../core/naming.mjs';
import { setMarkedFunctions } from '../../core/user-lexicon.mjs';
import { callLlm } from '../../core/llm.mjs';
import { makeLineSource } from '../../core/line-source.mjs';

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    ask: { type: 'string' },
    provider: { type: 'string', default: DEFAULT_GRAMMAR_PROVIDER },
    model: { type: 'string' },
    write: { type: 'boolean', default: false },
    limit: { type: 'string', default: '50' },
    jobs: { type: 'string', default: '10' },
    placeholders: { type: 'boolean', default: false },
    sheet: { type: 'string' },
    'apply-sheet': { type: 'string' },
  },
});
const limit = Number(opts.limit);
const jobs = opts.ask === 'model' ? Math.max(1, Number(opts.jobs)) : 1; // a person answers one at a time

function sourceFiles(paths) {
  const out = [];
  for (const p of paths.length ? paths : ['packages/core']) {
    if (statSync(p).isFile()) out.push(p);
    else out.push(...execSync(`git ls-files '${p}/*.mjs' '${p}/*.js' '${p}/*.ts' '${p}/*.tsx'`, { encoding: 'utf8' }).trim().split('\n').filter(Boolean));
  }
  return out.filter((f) => !/\.(test|spec)\.|node_modules|\.d\.ts$/.test(f));
}

// ---- answerers: English in, English out ---------------------------------------

const MODEL_BRIEF =
  'You describe parts of a computer program in plain, everyday English for people who do not read code. ' +
  'Reply with one short phrase only: no code, no symbols, no explanation, no quotes.';

const provider = opts.provider;
const model = opts.model ?? DEFAULT_GRAMMAR_MODELS[provider];

// Questions asked together go out in one call: numbered in, numbered out.
const askModel = batchedAsker(
  async (questions) => {
    const prompt = batchPrompt(MODEL_BRIEF, questions) + (provider === 'ollama' ? ' /no_think' : '');
    const raw = await callLlm(provider, prompt, { model, timeoutMs: 300000 });
    return parseBatchReply(raw.replace(/<think>[\s\S]*?<\/think>/g, ''), questions.length);
  },
  { size: jobs },
);

let lines = null;
async function askUser(question) {
  lines ??= makeLineSource(process.stdin);
  process.stdout.write(`\n${question}\n> `);
  const { done, value } = await lines.next();
  return done ? '' : value;
}

const ask = opts.ask === 'model' ? askModel : opts.ask === 'user' ? askUser : null;

// ---- the loop -----------------------------------------------------------------

function sweep(files) {
  const sources = files.map((file) => ({ file, source: readFileSync(file, 'utf8') }));
  setMarkedFunctions(markerTypes(sources));
  const lexicon = evaluateLexicon();
  const source = evaluateSource(files);
  const atoms = planAtomsInFiles(files, { markers: markersIn(sources) });
  const statements = files.reduce((n, file) => n + (readFileSync(file, 'utf8').match(/;\s*$|\}\s*$/gm) || []).length, 0);
  return { lexicon, source, atoms, statements };
}

function report(label, files, { lexicon, source, atoms, statements }) {
  const unclear = atoms.length + source.failures.length + source.gaps.length;
  const coverage = statements ? (100 * Math.max(0, statements - unclear)) / statements : 100;
  console.log(`\n== ${label}: ${files.length} files`);
  console.log(`   lexicon: ${lexicon.checked} sentences, ${lexicon.failures.length} failures`);
  console.log(`   declarations: ${source.checked}, ${source.failures.length} read badly, ${source.gaps.length} gaps`);
  console.log(`   statements to wrap as atoms: ${atoms.filter((a) => !a.needsPerson).length}; needing a person: ${atoms.filter((a) => a.needsPerson).length}`);
  console.log(`   coverage: ${coverage.toFixed(1)}% of statements read as valid English`);
}

const files = sourceFiles(positionals);

if (opts['apply-sheet']) {
  const sheet = JSON.parse(readFileSync(opts['apply-sheet'], 'utf8'));
  for (const file of [...new Set(sheet.map((e) => e.file))]) {
    const { source, applied, skipped } = applyNames(readFileSync(file, 'utf8'), sheet.filter((e) => e.file === file), file);
    writeFileSync(file, source);
    for (const a of applied) console.log(`   ${file}: ${a.placeholder} -> ${a.name} ("${a.does}")`);
    for (const k of skipped) console.log(`   ${file}: ${k.placeholder} kept — ${k.error}`);
  }
  process.exit(0);
}

if (opts.placeholders) {
  const sheet = [];
  for (const file of files) {
    const before = readFileSync(file, 'utf8');
    const { source } = extractWithPlaceholders(before, file);
    if (source !== before && opts.write) writeFileSync(file, source);
    sheet.push(...namingSheet(source, file));
  }
  if (opts.ask === 'model') {
    const replies = await inBatches(sheet, jobs, (e) => ask(optionsQuestion(e)));
    sheet.forEach((e, i) => (e.options = [...new Set([...parseOptions(replies[i]), ...e.options])].slice(0, 5)));
  }
  if (opts.ask === 'user') {
    for (const e of sheet) {
      const menu = e.options.map((o, i) => `  ${i + 1}. ${o}`).join('\n');
      const reply = (await askUser(`${e.file}:${e.line} ${e.placeholder}\n\n    ${e.snippet}\n\n  It works out: ${e.english}\n\nPick a name (number), type your own, or press Enter for 1:\n${menu}`)).trim();
      e.choice = !reply ? e.options[0] ?? null : /^\d+$/.test(reply) ? e.options[Number(reply) - 1] ?? null : reply;
    }
  } else {
    sheet.forEach((e) => (e.choice ??= null));
  }
  if (opts.sheet) {
    writeFileSync(opts.sheet, `${JSON.stringify(sheet, null, 2)}\n`);
    console.log(`Wrote ${sheet.length} placeholders to ${opts.sheet}; set each "choice", then run with --apply-sheet ${opts.sheet}.`);
  }
  if (opts.ask === 'user' && opts.write) {
    for (const file of [...new Set(sheet.map((e) => e.file))]) {
      const { source, applied, skipped } = applyNames(readFileSync(file, 'utf8'), sheet.filter((e) => e.file === file), file);
      writeFileSync(file, source);
      console.log(`   ${file}: ${applied.length} named, ${skipped.length} kept as placeholders`);
    }
  }
  if (!opts.sheet && !(opts.ask === 'user' && opts.write)) for (const e of sheet) console.log(`   ${e.file}:${e.line} ${e.placeholder}: ${e.options.join(' | ')}`);
  process.exit(0);
}
const before = sweep(files);
report('before', files, before);

if (!ask) {
  for (const a of before.atoms.slice(0, limit)) console.log(`   ${a.file}:${a.line} ${a.needsPerson ? `needs a person: ${a.problem}` : `atom: ${a.why}`}`);
  console.log('\nPass --ask model or --ask user to answer the questions, and --write to mark the code.');
  process.exit(before.lexicon.failures.length ? 1 : 0);
}

// Names: what does this function do?
const gaps = findUserDomainGaps(files).slice(0, limit);
const { accepted, rejected } = await correctGaps(gaps, ask, { concurrency: jobs });
console.log(`\nNames: ${accepted.length} answered, ${rejected.length} still unclear.`);
for (const a of accepted) {
  const home = files.find((f) => markFunction(readFileSync(f, 'utf8'), a.name, a.does, f) != null);
  console.log(`   ${a.name}: "${a.does}"${a.rename ? ` (clearer name: ${a.rename})` : ''}${home ? ` -> ${home}` : ' (defined outside these files)'}`);
  if (opts.write && home) writeFileSync(home, markFunction(readFileSync(home, 'utf8'), a.name, a.does, home));
}
for (const r of rejected) console.log(`   ${r.name}: unclear — ${r.error}`);

// Atoms: what would you call this part? One pass names every atom in a file
// (a model answers --jobs at a time), applies them all, then re-plans: lifting
// a piece can leave its parent short enough to read.
// A name must be new to the file and to this batch: two atoms answered alike
// would otherwise become two functions with one name.
async function nameAtom(atom, taken) {
  let question = atomQuestion(atom);
  let named = { error: 'no answer' };
  for (let attempt = 0; attempt < 2; attempt++) {
    named = nameFromAnswer(await ask(question));
    if (!('error' in named) && taken.has(named.name)) named = { error: `The name “${named.does}” is already used for another part; please choose a different one.` };
    if (!('error' in named)) {
      taken.add(named.name);
      break;
    }
    question = `${atomQuestion(atom)}\n\n${named.error}`;
  }
  return named;
}

async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

let wrapped = 0;
for (const file of files) {
  let source = readFileSync(file, 'utf8');
  for (let pass = 0; pass < 5 && wrapped < limit; pass++) {
    const atoms = planAtoms(source, file).atoms.slice(0, limit - wrapped);
    if (!atoms.length) break;
    const taken = new Set(source.match(/[A-Za-z_$][\w$]*/g));
    const names = await inBatches(atoms, jobs, (atom) => nameAtom(atom, taken));
    const ready = atoms.map((atom, i) => ({ atom, ...names[i] })).filter((x) => !('error' in x));
    for (const x of atoms.map((atom, i) => ({ atom, named: names[i] })).filter((x) => 'error' in x.named)) console.log(`   ${file}:${x.atom.line} still unnamed — ${x.named.error}`);
    if (!ready.length) break;
    source = applyAtoms(source, ready);
    wrapped += ready.length;
    for (const x of ready) console.log(`   ${file}:${x.atom.line} wrapped as ${x.name}: "${x.does}"`);
  }
  if (opts.write) writeFileSync(file, source);
}
console.log(`\nAtoms: ${wrapped} wrapped${opts.write ? '' : ' (not written; pass --write)'}.`);

if (opts.write) report('after', files, sweep(files));
