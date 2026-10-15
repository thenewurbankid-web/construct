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
//        [--inside haiku|qwen2.5-coder:7b] [--engine llama-server|ollama] [--engine-url url] [--outside opus|none] [--user opus|none] [--rounds 2] [--out dir]
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
import { claudeModel, claudeSession } from '../runner/claude-model.mjs';
import { isOllamaModel, ollamaModel } from '../runner/ollama-model.mjs';
import { llamaModel } from '../runner/llama-model.mjs';
import { candidatesFor, CATALOG_PATH, REFERENCE_PATH } from '../../generator/generator.mjs';
import { userStage } from './user-stage.mjs';
import { batches, answerTurn, askTurn, tellTurn, pickTurn } from './batch.mjs';
import { builtAnswers, covers, wordsOf } from '../build/build.mjs';
import { corpusFrom, train } from '../lexicon/lexicon.mjs';
import { gatePool } from '../../gate/isolated/isolated.mjs';

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
    const verdict = await runGate(answer, { grammar: checkGrammar, types: typesCheck, equivalence: () => eq });
    // Meaning: a new atom's sentence must say every meaningful word of the member, or two steps read the same
    // (padStart and padEnd both as `pads().by(n)`). Runs only once the rest passed, so it never hides another refusal.
    const name = entry?.key?.replace(/ #\d+$/, '').split('.').at(-1);
    if (verdict.pass && answer?.decision === 'new-atom' && name && !covers(answer.sentence ?? '', name)) {
      const missing = wordsOf(name).filter((w) => !covers(answer.sentence ?? '', w));
      return { ...verdict, pass: false, checks: { ...verdict.checks, grammar: 'fail' }, refusal: `The sentence does not say ${missing.map((w) => `\`${w}\``).join(', ')} (from ${name}); without it the step reads the same as a different one. Put the word in the sentence.` };
    }
    return verdict;
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
    const stages = [inside, outside, user];
    const real = (r) => r?.gate?.pass && r.answer?.decision !== 'not-expressible';
    const best = stages.find(real) ?? stages.find((r) => r?.gate?.pass) ?? user ?? outside ?? inside;
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
      // A not-expressible answer passes the gate but adds no atom: it is a gap with a reason, not a library entry.
      inLibrary: items.filter((i) => i.pass && i.answer?.decision !== 'not-expressible').length,
      notExpressible: items.filter((i) => i.pass && i.answer?.decision === 'not-expressible').length,
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

export async function main(argv = process.argv.slice(2), { log = console.log, makeModel: given, pick = (list) => list } = {}) {
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
      batch: { type: 'string', default: '0' },
      build: { type: 'boolean', default: false },
      'keep-open': { type: 'boolean', default: false },
      engine: { type: 'string', default: 'llama-server' },
      'engine-url': { type: 'string' },
      out: { type: 'string', default: fileURLToPath(new URL('./runs/latest/', import.meta.url)) },
    },
  });
  // --keep-open: each model's processes stay open across calls (claudeSession) instead of starting per call.
  const opened = [];
  // A name with a tag (qwen2.5-coder:7b) is a local model, run by llama-server (default) or Ollama (--engine ollama);
  // the rest go to the claude CLI.
  const local = (opts) => (o.engine === 'ollama' ? ollamaModel(opts) : llamaModel({ ...opts, ...(o['engine-url'] ? { url: o['engine-url'] } : {}) }));
  const makeModel = given ?? ((opts) => (isOllamaModel(opts.model) ? local(opts)
    : o['keep-open'] ? opened[opened.push(claudeSession(opts)) - 1] : claudeModel(opts)));
  const reference = readJson(REFERENCE_PATH).entries;
  const catalog = readJson(CATALOG_PATH).atoms;
  const sections = o.sections ? new Set(o.sections.split(',').map((s) => s.trim())) : null;
  let entries = reference.filter((e) => !sections || sections.has(e.section));
  if (o.limit) entries = entries.slice(0, Number(o.limit));
  entries = pick(entries);
  mkdirSync(o.out, { recursive: true });
  const resultsFile = `${o.out}/results.jsonl`;
  const all = readResults(resultsFile);
  // Answers are gated in worker processes, so one that allocates gigabytes or loops cannot take the run down.
  const gates = gatePool({ size: 4 });
  const gateOf = (entry) => (answer) => gates.gate(entry.key, answer);
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

  if (Number(o.batch) > 0) {
    await batchedStages(entries, { o, all, record, doneIn, stopped, jobs, makeModel, gateOf, catalog });
  } else {
    const insideDone = doneIn('inside');
    const insideModel = makeModel({ model: o.inside });
    await pool(entries.filter((e) => !insideDone.has(e.key)), jobs, async (e) => {
      record(await runStage(e, 'inside', { model: insideModel, modelName: o.inside, gate: gateOf(e), catalog }));
    }, stopped);

    if (o.outside !== 'none' && !stopped()) {
      const passedInside = new Set(all.filter((r) => r.stage === 'inside' && r.gate?.pass).map((r) => r.key));
      const outsideDone = doneIn('outside');
      const outsideModel = makeModel({ model: o.outside });
      await pool(entries.filter((e) => insideDone.has(e.key) || all.some((r) => r.key === e.key && r.stage === 'inside' && !r.error))
        .filter((e) => !passedInside.has(e.key) && !outsideDone.has(e.key)), jobs, async (e) => {
        record(await runStage(e, 'outside', { model: outsideModel, modelName: o.outside, gate: gateOf(e), catalog }));
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
        record(await userStage(e, lastInside(e.key), { asker, user: person, gate: gateOf(e), catalog, rounds: Number(o.rounds), names: { asker: o.inside, user: o.user } }));
      }, stopped);
    }
  }

  for (const m of opened) m.close();
  gates.close();
  const { summary, library } = summarize(all, entries);
  summary.stoppedOnErrors = stopped();
  summary.models = { inside: o.inside, outside: o.outside, user: o.user };
  writeFileSync(`${o.out}/summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(`${o.out}/library.json`, `${JSON.stringify(library, null, 2)}\n`);
  log(`\n${summary.inLibrary} of ${summary.entries} entries in the library (${summary.knownGaps} known gaps). Inside ${o.inside}: ${summary.inside.passed}/${summary.inside.entries}, $${summary.inside.costUsd}, ${summary.inside.minutes} min. Outside ${o.outside}: ${summary.outside.passed}/${summary.outside.entries}, $${summary.outside.costUsd}, ${summary.outside.minutes} min. ${o.inside} with ${o.user} as user: ${summary.user.passed}/${summary.user.entries}, $${summary.user.costUsd}, ${summary.user.minutes} min.${summary.stoppedOnErrors ? ' Stopped on repeated model errors; run again to resume.' : ''}`);
  return summary;
}

/**
 * The batched run (--batch n): turn 1 and turn 2 (refused ones, with their refusals) by the inside model, then the
 * user stage, every turn one call per batch of a section's entries. Results are recorded per entry, as unbatched.
 */
async function batchedStages(entries, { o, all, record, doneIn, stopped, jobs, makeModel, gateOf, catalog }) {
  const catalogAll = catalog;
  const grammarVerbs = readJson(fileURLToPath(new URL('../../../line-smith/src/atoms/naming.json', import.meta.url))).grammar.verbs;
  const size = Number(o.batch);
  const inside = makeModel({ model: o.inside });
  const item = (entry, extra = {}) => ({ entry, candidates: candidatesFor(entry, catalog).slice(0, MAX_CANDIDATES), ...extra });
  const latest = (key, stage) => [...all].reverse().find((r) => r.key === key && r.stage === stage && !r.error);
  // Not-expressible passes the gate but adds nothing: a last resort, so it gets turn 2 and the user stage too.
  const dodged = (r) => r?.gate?.pass && r.answer?.decision === 'not-expressible';
  const refusalOf = (r) => (dodged(r)
    ? `You answered not-expressible (${r.answer.reason ?? 'no reason'}). That is a last resort: most steps can be said with a subject, a verb and role words; try a sentence.`
    : r?.gate?.refusal);
  const fail = (group, stage, model, e, started) => group.forEach((it) => record({ key: it.entry.key, section: it.entry.section, stage, model, entry: it.entry.id, error: String(e?.message ?? e).slice(0, 300), costUsd: 0, ms: Date.now() - started }));

  // Built first: the rules build answers (no model), the gate checks each, and where any pass the inside model only
  // picks among them or corrects one when confident (pickTurn). The rest go on to turns 1 and 2.
  if (o.build) {
    // The lexicon is retrained from the catalog and every answer that passed so far, so each run learns from the last.
    const lexicon = train(corpusFrom(catalogAll, all.filter((r) => r.gate?.pass && r.answer?.sentence).map((r) => r.answer)));
    const verbWords = new Set(grammarVerbs);
    const built = new Map();
    await pool(entries.filter((e) => !doneIn('inside').has(e.key)), Math.max(2, jobs), async (e) => {
      const passing = [];
      for (const a of builtAnswers(e, catalog, { lexicon, verbWords }).answers) {
        if ((await gateOf(e)(a)).pass) passing.push(a);
        if (passing.length >= 4) break;
      }
      if (passing.length) built.set(e.key, passing);
    }, stopped);
    await pool(batches(entries.filter((e) => built.has(e.key)), size), Math.ceil(jobs / 2), async (group) => {
      const started = Date.now();
      const items = group.map((entry) => ({ entry, built: built.get(entry.key) }));
      try {
        const out = await pickTurn(items, { model: inside, gateOf });
        const ms = Math.round((Date.now() - started) / items.length);
        out.forEach((r, i) => record({ key: items[i].entry.key, section: items[i].entry.section, stage: 'inside', model: `rules+${o.inside}`, entry: items[i].entry.id, ...r, tries: 1, ms, batch: items.length, built: items[i].built.length }));
      } catch (e) {
        // The model is only choosing words here: without it, the first built answer stands.
        items.forEach((it) => record({ key: it.entry.key, section: it.entry.section, stage: 'inside', model: 'rules', entry: it.entry.id, answer: it.built[0], gate: { pass: true, checks: {}, refusal: null, fixes: [] }, how: `first built (pick failed: ${String(e?.message ?? e).slice(0, 120)})`, tries: 1, costUsd: 0, ms: Date.now() - started, built: it.built.length }));
      }
    }, stopped);
  }

  // Turns 1 and 2: every entry not yet through the inside stage, then each refused one with its refusal.
  for (const turn of [1, 2]) {
    if (stopped()) return;
    const todo = turn === 1
      ? entries.filter((e) => !doneIn('inside').has(e.key))
      : entries.filter((e) => { const r = latest(e.key, 'inside'); return r && (!r.gate?.pass || dodged(r)) && (r.tries ?? 1) < 2; });
    await pool(batches(todo, size), Math.ceil(jobs / 2), async (group) => {
      const started = Date.now();
      const items = group.map((e) => item(e, turn === 2 ? { refusal: refusalOf(latest(e.key, 'inside')) } : {}));
      try {
        const out = await answerTurn(items, { model: inside, gateOf });
        const ms = Math.round((Date.now() - started) / items.length);
        out.forEach((r, i) => record({ key: items[i].entry.key, section: items[i].entry.section, stage: 'inside', model: o.inside, entry: items[i].entry.id, ...r, tries: turn, ms, batch: items.length }));
      } catch (e) {
        fail(items, 'inside', o.inside, e, started);
      }
    }, stopped);
  }

  // The user stage: the inside model asks, the user model answers as the person, the inside model answers again.
  if (o.user === 'none' || stopped()) return;
  const person = makeModel({ model: o.user });
  const passed = () => new Set(all.filter((r) => r.gate?.pass && !dodged(r)).map((r) => r.key));
  const todo = entries.filter((e) => latest(e.key, 'inside') && !passed().has(e.key) && !doneIn('user').has(e.key));
  await pool(batches(todo, size), Math.ceil(jobs / 2), async (group) => {
    const started = Date.now();
    const every = group.map((e) => { const r = latest(e.key, 'inside'); return item(e, { answer: r.answer, refusal: r.gate?.refusal, prior: r.gate, dialogue: [], result: null, cost: 0, tries: 0 }); });
    for (const it of every) if (dodged({ gate: it.prior, answer: it.answer })) it.refusal = refusalOf({ gate: it.prior, answer: it.answer });
    let items = every;
    try {
      for (let round = 0; round < Number(o.rounds) && items.length; round++) {
        const asked = await askTurn(items, { model: inside });
        const ready = items.filter((_, i) => asked.questions[i]);
        const qs = asked.questions.filter(Boolean);
        if (!ready.length) break;
        const told = await tellTurn(ready, qs, { model: person });
        const talk = ready.filter((it, i) => {
          if (!told.answers[i]) return false;
          it.dialogue.push({ q: qs[i], a: told.answers[i] });
          return true;
        });
        if (!talk.length) break;
        const out = await answerTurn(talk, { model: inside, gateOf });
        const overhead = ((asked.reply?.costUsd ?? 0) + (told.reply?.costUsd ?? 0)) / talk.length;
        out.forEach((r, i) => Object.assign(talk[i], { result: r, answer: r.answer, refusal: r.gate.refusal, cost: talk[i].cost + r.costUsd + overhead, tries: talk[i].tries + 1 }));
        items = talk.filter((it) => !it.result.gate.pass);
      }
    } catch (e) {
      fail(every, 'user', `${o.inside}+${o.user} as user`, e, started);
      return;
    }
    const ms = Math.round((Date.now() - started) / every.length);
    for (const it of every) {
      record({
        key: it.entry.key, section: it.entry.section, stage: 'user', model: `${o.inside}+${o.user} as user`, entry: it.entry.id,
        answer: it.result?.answer ?? it.answer ?? null, gate: it.result?.gate ?? it.prior, dialogue: it.dialogue, tries: it.tries,
        tokensIn: it.result?.tokensIn ?? 0, tokensOut: it.result?.tokensOut ?? 0, costUsd: Number(it.cost.toFixed(6)), ms, batch: every.length,
      });
    }
  }, stopped);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
