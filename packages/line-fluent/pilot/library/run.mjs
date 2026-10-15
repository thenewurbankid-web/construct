// Library run (T1.4): every C1 reference entry through the stage 1 pipeline, Haiku inside and Opus outside.
//
//   inside   each entry goes to the inside model (default haiku): request -> C2 answer -> C3 gate, one retry
//            with the refusal (runner.mjs).
//   outside  each entry the inside model could not get through the gate goes to the outside model (default
//            opus), same request, same gate, same one retry.
//
// The gate is the full C3 gate: schema, grammar, equivalence (run against real JS) and types. Every result is
// appended to <out>/results.jsonl as it lands, so a stopped run resumes where it stopped; <out>/summary.json holds
// pass rates, tries, tokens, cost and time per stage and per section, and <out>/library.json holds each entry's
// best gated answer. Nothing is approved here: approving into line-smith stays a person's step (generator/cli.mjs).
//
//   node packages/line-fluent/pilot/library/run.mjs [--sections Array,String] [--limit n] [--jobs n]
//        [--inside haiku] [--outside opus|none] [--user opus|none] [--rounds 2] [--out dir]
//
//   user     (--user opus) each entry no earlier stage got through: the inside model asks the person one plain
//            question, the user model answers as the person, the inside model answers again (user-stage.mjs).
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { runGate } from '../../gate/assemble.mjs';
import { checkGrammar } from '../../gate/grammar/grammar.mjs';
import { checkEquivalence } from '../../gate/equivalence/equivalence.mjs';
import { makeTypesCheck } from '../../gate/types/types.mjs';
import { validateAnswer } from '../../contract/validate.mjs';
import { buildRequest, MAX_CANDIDATES } from '../request/request.mjs';
import { runPilot } from '../runner/runner.mjs';
import { claudeModel } from '../runner/claude-model.mjs';
import { candidatesFor, CATALOG_PATH, REFERENCE_PATH } from '../../generator/generator.mjs';
import { userStage } from './user-stage.mjs';

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const SKIP = Object.freeze({ check: 'skip', errors: [], fixes: [] });

/** The full C3 gate for one entry: equivalence runs once per answer (it is async), the rest inline. */
export function gateFor(entry, { typesCheck, equivalence = checkEquivalence } = {}) {
  return async (answer) => {
    let eq = SKIP;
    if (validateAnswer(answer).check !== 'fail') {
      try {
        eq = await equivalence(answer, { entry: entry.key });
      } catch (e) {
        eq = { check: 'fail', errors: [`The equivalence check could not run this answer (${String(e?.message ?? e).split('\n')[0]}); give js that runs as written.`], fixes: [] };
      }
    }
    return runGate(answer, { grammar: checkGrammar, types: typesCheck, equivalence: () => eq });
  };
}

/** A model wrapper that adds up the CLI's cost per entry (the runner keeps tokens, not cost). */
function costing(model) {
  let cost = 0;
  const wrapped = async (request) => {
    const reply = await model(request);
    cost += reply.costUsd ?? 0;
    return reply;
  };
  wrapped.take = () => {
    const c = cost;
    cost = 0;
    return c;
  };
  return wrapped;
}

/** One entry through one model: the runner's result plus stage, section, model and cost. */
export async function runStage(entry, stage, { model, modelName, gate, catalog, maxRetries = 1 }) {
  const candidates = candidatesFor(entry, catalog).slice(0, MAX_CANDIDATES);
  const build = (e, { refusal }) => buildRequest(e, { candidates, refusal, shapes: true });
  const priced = costing(model);
  const started = Date.now();
  try {
    const { results } = await runPilot([entry], { model: priced, gate, build, maxRetries });
    return { key: entry.key, section: entry.section, stage, model: modelName, ...results[0], costUsd: priced.take() };
  } catch (e) {
    return { key: entry.key, section: entry.section, stage, model: modelName, entry: entry.id, error: String(e?.message ?? e).slice(0, 300), costUsd: priced.take(), ms: Date.now() - started };
  }
}

/** Runs `fn` over items with at most `jobs` at once; stops starting new items once `stop()` is true. */
export async function pool(items, jobs, fn, stop = () => false) {
  const queue = [...items];
  const worker = async () => {
    for (let item = queue.shift(); item !== undefined && !stop(); item = queue.shift()) await fn(item);
  };
  await Promise.all(Array.from({ length: Math.max(1, jobs) }, worker));
}

/** Pass rate, tries, tokens, cost and time over a set of stage results, plus decisions and errors. */
export function totals(results) {
  const n = results.length;
  const passed = results.filter((r) => r.gate?.pass).length;
  const sum = (k) => results.reduce((a, r) => a + (r[k] ?? 0), 0);
  const decisions = {};
  for (const r of results) if (r.gate?.pass && r.answer?.decision) decisions[r.answer.decision] = (decisions[r.answer.decision] ?? 0) + 1;
  const failedOn = {};
  for (const r of results) {
    if (r.gate && !r.gate.pass) for (const [check, v] of Object.entries(r.gate.checks ?? {})) if (v === 'fail') failedOn[check] = (failedOn[check] ?? 0) + 1;
  }
  return {
    entries: n,
    passed,
    passRate: n ? passed / n : 0,
    errors: results.filter((r) => r.error).length,
    calls: sum('tries'),
    tokensIn: sum('tokensIn'),
    tokensOut: sum('tokensOut'),
    costUsd: Number(sum('costUsd').toFixed(4)),
    minutes: Number((sum('ms') / 60000).toFixed(1)),
    decisions,
    failedOn,
  };
}

/** The summary and the library (each entry's best gated answer: outside beats inside only when inside failed). */
export function summarize(all, entries) {
  const latest = new Map();
  for (const r of all) latest.set(`${r.key}\u0000${r.stage}`, r);
  const byStage = (stage) => [...latest.values()].filter((r) => r.stage === stage);
  const library = {};
  for (const e of entries) {
    const inside = latest.get(`${e.key}\u0000inside`);
    const outside = latest.get(`${e.key}\u0000outside`);
    const user = latest.get(`${e.key}\u0000user`);
    const best = [inside, outside, user].find((r) => r?.gate?.pass) ?? user ?? outside ?? inside;
    if (best) library[e.key] = { entry: e.id, section: e.section, stage: best.stage, model: best.model, pass: Boolean(best.gate?.pass), answer: best.answer ?? null, refusal: best.gate?.refusal ?? best.error ?? null };
  }
  const sections = {};
  for (const item of Object.values(library)) {
    const s = (sections[item.section] ??= { entries: 0, passed: 0, inside: 0, outside: 0, user: 0 });
    s.entries++;
    if (item.pass) {
      s.passed++;
      s[item.stage]++;
    }
  }
  const items = Object.values(library);
  return {
    summary: {
      entries: entries.length,
      done: items.length,
      inLibrary: items.filter((i) => i.pass).length,
      knownGaps: items.filter((i) => !i.pass).length,
      byDecision: items.filter((i) => i.pass).reduce((a, i) => ((a[i.answer.decision] = (a[i.answer.decision] ?? 0) + 1), a), {}),
      inside: totals(byStage('inside')),
      outside: totals(byStage('outside')),
      user: totals(byStage('user')),
      sections,
    },
    library,
  };
}

function readResults(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

export async function main(argv = process.argv.slice(2), { log = console.log, makeModel = claudeModel } = {}) {
  const { values: o } = parseArgs({
    args: argv,
    options: {
      sections: { type: 'string' },
      limit: { type: 'string' },
      jobs: { type: 'string', default: '6' },
      inside: { type: 'string', default: 'haiku' },
      outside: { type: 'string', default: 'opus' },
      user: { type: 'string', default: 'none' },
      rounds: { type: 'string', default: '2' },
      out: { type: 'string', default: fileURLToPath(new URL('./runs/latest/', import.meta.url)) },
    },
  });
  const reference = readJson(REFERENCE_PATH).entries;
  const catalog = readJson(CATALOG_PATH).atoms;
  const sections = o.sections ? new Set(o.sections.split(',').map((s) => s.trim())) : null;
  let entries = reference.filter((e) => !sections || sections.has(e.section));
  if (o.limit) entries = entries.slice(0, Number(o.limit));
  mkdirSync(o.out, { recursive: true });
  const resultsFile = `${o.out}/results.jsonl`;
  const all = readResults(resultsFile);
  const typesCheck = makeTypesCheck(reference);
  const jobs = Number(o.jobs);

  // A run of model errors (a usage limit, the CLI gone) stops the run instead of filling it with failures.
  let streak = 0;
  const stopped = () => streak >= Math.max(5, jobs * 2);
  const record = (result) => {
    const r = { ...result, at: new Date().toISOString() };
    all.push(r);
    appendFileSync(resultsFile, `${JSON.stringify(r)}\n`);
    streak = r.error ? streak + 1 : 0;
    const mark = r.error ? `error: ${r.error}` : r.gate?.pass ? `pass (${r.answer?.decision}, ${r.tries} tr)` : `refused: ${String(r.gate?.refusal ?? '').slice(0, 90)}`;
    log(`[${r.stage}] ${r.key}: ${mark}`);
    for (const d of r.dialogue ?? []) log(`    asks: ${d.q}\n    user: ${d.a}`);
  };
  const doneIn = (stage) => new Set(all.filter((r) => r.stage === stage && !r.error).map((r) => r.key));

  const insideDone = doneIn('inside');
  const insideModel = makeModel({ model: o.inside });
  await pool(entries.filter((e) => !insideDone.has(e.key)), jobs, async (e) => {
    record(await runStage(e, 'inside', { model: insideModel, modelName: o.inside, gate: gateFor(e, { typesCheck }), catalog }));
  }, stopped);

  if (o.outside !== 'none' && !stopped()) {
    const passedInside = new Set(all.filter((r) => r.stage === 'inside' && r.gate?.pass).map((r) => r.key));
    const outsideDone = doneIn('outside');
    const outsideModel = makeModel({ model: o.outside });
    await pool(entries.filter((e) => insideDone.has(e.key) || all.some((r) => r.key === e.key && r.stage === 'inside' && !r.error))
      .filter((e) => !passedInside.has(e.key) && !outsideDone.has(e.key)), jobs, async (e) => {
      record(await runStage(e, 'outside', { model: outsideModel, modelName: o.outside, gate: gateFor(e, { typesCheck }), catalog }));
    }, stopped);
  }

  if (o.user !== 'none' && !stopped()) {
    // The inside model asks, the user model answers as the person; only entries no earlier stage got through.
    const passed = new Set(all.filter((r) => r.gate?.pass).map((r) => r.key));
    const userDone = doneIn('user');
    const asker = makeModel({ model: o.inside });
    const person = makeModel({ model: o.user });
    const lastInside = (key) => [...all].reverse().find((r) => r.key === key && r.stage === 'inside' && !r.error);
    await pool(entries.filter((e) => lastInside(e.key) && !passed.has(e.key) && !userDone.has(e.key)), jobs, async (e) => {
      record(await userStage(e, lastInside(e.key), { asker, user: person, gate: gateFor(e, { typesCheck }), catalog, rounds: Number(o.rounds), names: { asker: o.inside, user: o.user } }));
    }, stopped);
  }

  const { summary, library } = summarize(all, entries);
  summary.stoppedOnErrors = stopped();
  summary.models = { inside: o.inside, outside: o.outside, user: o.user };
  writeFileSync(`${o.out}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(`${o.out}/library.json`, `${JSON.stringify(library, null, 2)}\n`);
  log(`\n${summary.inLibrary} of ${summary.entries} entries in the library (${summary.knownGaps} known gaps). Inside ${o.inside}: ${summary.inside.passed}/${summary.inside.entries}, $${summary.inside.costUsd}, ${summary.inside.minutes} min. Outside ${o.outside}: ${summary.outside.passed}/${summary.outside.entries}, $${summary.outside.costUsd}, ${summary.outside.minutes} min. ${o.inside} with ${o.user} as user: ${summary.user.passed}/${summary.user.entries}, $${summary.user.costUsd}, ${summary.user.minutes} min.${summary.stoppedOnErrors ? ' Stopped on repeated model errors; run again to resume.' : ''}`);
  return summary;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
