#!/usr/bin/env node
// The grammar eval loop, end to end:
//
//   1. sweep   — every lexicon sentence (lint + read back + compile) and every
//                top-level declaration in the files (lint + gaps).
//   2. ask     — every user-domain name the mapper can only guess at, and every
//                statement that can't be said in one clean sentence (an atom),
//                as a plain-English question. The answerer is a small local
//                model (--ask model, default qwen3:1.7b through Ollama) or the
//                person at the terminal (--ask user). Neither ever sees code.
//                A model is asked --jobs questions at a time (default 4).
//   3. mark    — with --write, each accepted answer is written onto the
//                top-level function it describes as a `@does` marker, and each
//                atom is extracted into its own marked function — every atom
//                of one pass at once, then the file is re-planned.
//   4. re-sweep, and report coverage: the share of statements that read as
//                valid English. The goal is 100%; whatever is left is listed
//                with the reason a person is needed.
//
// Usage: node packages/tools/grammar-eval/run.mjs [--ask model|user] [--model qwen3:1.7b]
//          [--write] [--limit N] [--jobs N] [paths...]          (default path: packages/core)
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { evaluateLexicon, evaluateSource, findUserDomainGaps } from '../../core/grammar-eval.mjs';
import { correctGaps, markFunction, markerTypes, markersIn, DEFAULT_GRAMMAR_MODEL } from '../../core/corrections.mjs';
import { planAtoms, planAtomsInFiles, atomQuestion, nameFromAnswer, applyAtoms } from '../../core/atoms.mjs';
import { setMarkedFunctions } from '../../core/user-lexicon.mjs';
import { callLlm } from '../../core/llm.mjs';
import { makeLineSource } from '../../core/line-source.mjs';

const { values: opts, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    ask: { type: 'string' },
    model: { type: 'string', default: DEFAULT_GRAMMAR_MODEL },
    write: { type: 'boolean', default: false },
    limit: { type: 'string', default: '50' },
    jobs: { type: 'string', default: '4' },
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

async function askModel(question) {
  const raw = await callLlm('ollama', `${MODEL_BRIEF}\n\n${question} /no_think`, { model: opts.model, timeoutMs: 120000 });
  return raw.replace(/<think>[\s\S]*?<\/think>/g, '').trim().split('\n')[0];
}

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
async function nameAtom(atom) {
  let named = nameFromAnswer(await ask(atomQuestion(atom)));
  if ('error' in named) named = nameFromAnswer(await ask(`${atomQuestion(atom)}\n\n${named.error}`));
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
    const names = await inBatches(atoms, jobs, nameAtom);
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
