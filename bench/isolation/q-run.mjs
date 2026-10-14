#!/usr/bin/env node
// #947 -- QuickJS isolation run q-r1: the QuickJS sandbox used for reasoning, on the same 12 tasks. One run through
// heavy.sh writes results/q-r1.{jsonl,md} (r1.jsonl's row format for the sampler setups, plus `q` fields).
//
//   LSP_SMITH_RAW=1 LINE_LINKS_ALLOW_DRIFT=1 ATOMIC_CODEMOD_SOURCE_DIR=~/Repositories/atomic-codemod-hardening \
//     SMITH_SOURCE_DIR=~/Repositories/smith <og-final-1012>/packages/tools/dev/heavy.sh node bench/isolation/q-run.mjs
//   node bench/isolation/q-run.mjs --only plans,quick,refs     # the model-free parts
//
// Parts (every one runs candidates in QuickJS through bench/isolation/quickjs/view.mjs, never jsdom):
//   compare  quickjs/compare.mjs's tables (vm vs QuickJS), read from results/q-compare.json when present
//   plans    Q-plan: each task's plan sketch (plans/<task>.plan.js view) and its wrong sketch (wrongView) on the task's
//            examples (quickjs/examples.mjs, read off check.mjs)
//   quick    Q-plan on the 4 quick logic tasks: K2b's 7b and 1.5b code sketches and K5b's runs (inputs/, copied from
//            exp/english-loop-chain fbce3355) executed on each task's check examples, against Smith's text match
//   refs     Q-exec and Q-diff on every reference and on the r3 H+fix fills K6 judged (K6: Smith text vs Claude plans)
//   sampler  H+fix [r3's arm] and Q-exec (H+fix, each final-function candidate run on the task's examples in QuickJS
//            before tsc and the check; a candidate that fails them is dropped), paired: the coder's replies are cached
//            by prompt and seed, so both setups judge the same samples
//   census   every one of the 5 samples of each task's final function: tsc + check, Smith text match (canonical Smith
//            of the fill vs the reference's, lsp-r3's L-gate-canon), Q-exec, Q-diff (candidate vs plan sketch)
import fs from 'node:fs';
import path from 'node:path';
import * as config from './config.mjs';
import * as run from './run.mjs';
import { makeWorkspace } from './lib/workspace.mjs';
import { buildBriefs } from './blocks/briefBuilder.mjs';
import { applyPrelude, spliceFunction } from './blocks/spliceApplier.mjs';
import { bundleCandidate, runScenarios, match, planModule } from './quickjs/view.mjs';
import { EXAMPLES, BOOKS, expectFromPlan } from './quickjs/examples.mjs';
import { evalGuest, QUICKJS_PACKAGE } from '../../packages/engine/line/logicVerify/quickjs/quickjsRun.mjs';
import { ts } from './lib/edit.mjs';
import { TASKS as QUICK } from './chain/quick/tasks.mjs';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(`--${k}`); return i >= 0 ? args[i + 1] : null; };
const RUN = opt('run') ?? 'q-r1';
run.setRunName(RUN);
const HERE = run.HERE;
const RESULTS = run.RESULTS;
const only = opt('only') ? new Set(opt('only').split(',')) : null;
const want = (k) => !only || only.has(k);
const taskIds = opt('tasks') ? new Set(opt('tasks').split(',')) : null;
const TASKS = run.tasks.filter((t) => !taskIds || taskIds.has(t.id));
const DRY = args.includes('--dry');
const notes = {};
const rows = [];
const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

// ------------------------------------------------------------------ the QuickJS checks
const qws = new Map();
/** One workspace per task for bundling (with the _scope overlay the fixer arms use); never written to after. */
function baseWs(task) {
  if (!qws.has(task.id)) { const ws = path.join(HERE, '.work', RUN, 'q', task.id); makeWorkspace(ws, task, null, { overlays: ['_scope'] }); qws.set(task.id, ws); }
  return qws.get(task.id);
}
const plans = new Map();
const planOf = (task) => {
  if (!plans.has(task.id)) { const f = path.join(HERE, 'plans', `${task.id}.plan.js`); plans.set(task.id, fs.existsSync(f) ? planModule(f) : null); }
  return plans.get(task.id);
};
const CANT = /^(ReferenceError)/;
/**
 * Run a candidate file (the whole target file) on scenarios in QuickJS. verdict: pass | fail | cant-tell. cant-tell
 * (never a drop): the bundle does not build (an unresolved import or name the importFixer may still fix), or a
 * ReferenceError (a missing import); everything else that throws or misses an expectation is a fail.
 */
async function qRun(task, body, { scenarios, expectOf, plan = null }) {
  const t0 = performance.now();
  const b = await bundleCandidate(baseWs(task), task, body);
  const bundleMs = performance.now() - t0;
  if (!b.ok) return { verdict: 'cant-tell', why: `bundle: ${b.error}`, ms: bundleMs, bundleMs };
  const r = await runScenarios({ bundle: b.code, plan, scenarios, books: BOOKS, kind: task.kind });
  const ms = performance.now() - t0;
  if (!r.ok) return { verdict: 'fail', why: `${r.kind}: ${r.error}`, ms, bundleMs };
  if (r.loadError) return { verdict: CANT.test(r.loadError) ? 'cant-tell' : 'fail', why: `load: ${r.loadError}`, ms, bundleMs };
  const fails = [];
  for (let i = 0; i < scenarios.length; i++) {
    const v = r.views[i];
    if (v?.thrown && CANT.test(v.thrown)) return { verdict: 'cant-tell', why: v.thrown, ms, bundleMs };
    const exp = expectOf(i, r.planViews?.[i]);
    if (!exp) { fails.push(`scenario ${i}: the plan gave no view (${r.planViews?.[i]?.thrown ?? r.planLoadError ?? '?'})`); continue; }
    const f = match(exp, v);
    if (f.length) fails.push(`scenario ${i}: ${f[0]}`);
  }
  return { verdict: fails.length ? 'fail' : 'pass', failures: fails.slice(0, 3), failed: fails.length, of: scenarios.length, ms, bundleMs };
}
const qExec = (task, body) => {
  const ex = EXAMPLES[task.id];
  return qRun(task, body, { scenarios: ex.examples.map((e) => e.scenario), expectOf: (i) => ex.examples[i].expect });
};
const qDiff = (task, body) => {
  const ex = EXAMPLES[task.id];
  const plan = planOf(task);
  if (!plan) return Promise.resolve({ verdict: 'cant-tell', why: 'no plan sketch' });
  return qRun(task, body, { scenarios: ex.scenarios, plan, expectOf: (_i, pv) => expectFromPlan(pv) });
};
/** Q-plan: a plan sketch's view function on the task's examples. */
async function qPlan(task, fn) {
  const ex = EXAMPLES[task.id];
  const r = await runScenarios({ plan: planOf(task), planFn: fn, scenarios: ex.examples.map((e) => e.scenario), books: BOOKS, kind: task.kind });
  if (!r.ok) return { pass: false, why: r.error, ms: r.ms };
  const fails = ex.examples.map((e, i) => match(e.expect, r.planViews?.[i])).flatMap((f, i) => f.map((x) => `example ${i}: ${x}`));
  return { pass: !fails.length, failures: fails.slice(0, 2), ms: r.ms };
}

// ------------------------------------------------------------------ part: plans (12 tasks)
async function partPlans() {
  const out = [];
  for (const task of TASKS) {
    const right = await qPlan(task, 'view');
    const wrong = await qPlan(task, 'wrongView');
    out.push({ task: task.id, plan: right.pass, planWhy: right.failures ?? right.why ?? null, wrongCaught: !wrong.pass, wrongWhy: wrong.failures?.[0] ?? null, ms: Math.round(right.ms + wrong.ms) });
  }
  notes.plans = out;
}

// ------------------------------------------------------------------ part: quick (K2b / K5b sketches, 4 logic tasks)
const toCjs = (src, prelude = '') => ts.transpileModule(prelude + src, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS } }).outputText;
async function runQuickCheck(task, src) {
  const code = `const exports = {}; const module = { exports };\n${toCjs(src, task.prelude ?? '')}\nconst m = module.exports === exports ? exports : module.exports;\nconst check = ${task.check.toString()};\nlet r; try { r = check(m) === true ? 'pass' : 'fail'; } catch (e) { r = 'threw ' + (e && e.name); } r;`;
  const r = await evalGuest(code, { timeoutMs: 2000 });
  return r.ok ? r.value : `error ${r.error}`;
}
async function partQuick() {
  const read = (f) => JSON.parse(fs.readFileSync(path.join(HERE, 'quickjs/inputs', f), 'utf8'));
  const k2b = read('k2b.json');
  const k5b = read('k5b.json');
  const byId = Object.fromEntries(QUICK.map((t) => [t.id, t]));
  const out = { k2b: {}, k5b: {}, refs: {}, mutants: {} };
  for (const t of QUICK) {
    out.refs[t.id] = await runQuickCheck(t, t.reference);
    out.mutants[t.id] = await Promise.all(t.mutants.map((m) => runQuickCheck(t, m)));
  }
  for (const [model, v] of Object.entries(k2b)) {
    const rs = [];
    for (const r of v.rows) {
      const t = byId[r.task];
      const exec = await runQuickCheck(t, r.sketch);
      rs.push({ task: r.task, sample: r.sample, exec, textMatch: r.match });
    }
    out.k2b[model] = rs;
  }
  for (const [model, v] of Object.entries(k5b)) {
    const t = byId.availability;
    const rs = [];
    for (const r of v.runs) rs.push({ run: r.run, sketchExec: await runQuickCheck(t, r.sketch), fillExec: r.code ? await runQuickCheck(t, r.code) : null, textPass: r.pass, planRight: r.planRight, unit: r.unit });
    out.k5b[model] = rs;
  }
  notes.quick = out;
}

// ------------------------------------------------------------------ part: refs (references and K6's r3 fills)
async function partRefs() {
  const k6 = JSON.parse(fs.readFileSync(path.join(HERE, 'quickjs/inputs/k6.json'), 'utf8'));
  const out = [];
  for (const task of TASKS) {
    const ref = fs.readFileSync(path.join(task.dir, 'reference', task.target), 'utf8');
    const start = fs.readFileSync(path.join(baseWs(task), task.target), 'utf8');
    const k = k6.rows.find((r) => r.task === task.id);
    const fillFile = k?.fillFile ? path.join(HERE, k.fillFile) : null;
    const fill = fillFile && fs.existsSync(fillFile) ? fs.readFileSync(fillFile, 'utf8') : null;
    const [rx, rd, sx, fx, fd] = [await qExec(task, ref), await qDiff(task, ref), await qExec(task, start), fill ? await qExec(task, fill) : null, fill ? await qDiff(task, fill) : null];
    out.push({ task: task.id, refExec: rx.verdict, refExecWhy: rx.failures?.[0] ?? rx.why ?? null, refDiff: rd.verdict, refDiffWhy: rd.failures?.[0] ?? rd.why ?? null, startExec: sx.verdict,
      k6RefText: k?.reference?.pass ?? null, fillFile: k?.fillFile ?? null, r3Check: k?.r3Pass ?? null, k6FillText: k?.fill?.pass ?? null,
      fillExec: fx?.verdict ?? null, fillDiff: fd?.verdict ?? null, fillDiffWhy: fd?.failures?.[0] ?? fd?.why ?? null, ms: { refExec: Math.round(rx.ms), refDiff: Math.round(rd.ms ?? 0) } });
  }
  notes.refs = out;
}

// ------------------------------------------------------------------ part: sampler (H+fix vs Q-exec, paired)
// The coder's replies are cached by request body (model, prompt, options incl. seed): the second setup draws the same
// samples without a model call. Model time is reported from the first draw.
const replyCache = new Map();
const modelMs = new Map();
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  if (!String(url).includes('/api/chat') || typeof init.body !== 'string') return realFetch(url, init);
  const key = init.body;
  if (replyCache.has(key)) return new Response(replyCache.get(key), { status: 200, headers: { 'content-type': 'application/json' } });
  if (DRY) return new Response(JSON.stringify({ message: { role: 'assistant', content: '' }, prompt_eval_count: 0, eval_count: 0 }), { status: 200 });
  const t0 = Date.now();
  const res = await realFetch(url, init);
  const text = await res.text();
  if (res.ok) { replyCache.set(key, text); modelMs.set(key, Date.now() - t0); }
  return new Response(text, { status: res.status, headers: { 'content-type': 'application/json' } });
};
const finalFiles = new Map(); // task -> {file, brief} going into the final function's round (from the H+fix setup)
const qLog = new Map(); // `${arm}|${task}` -> [{i, verdict, ms, why}]
run.strategies.qBlocks = async (arm, ctx) => {
  const task = ctx.material.task;
  const log = [];
  qLog.set(`${arm.key}|${task.id}`, log);
  // the brief builder is wrapped only to learn which brief is the last (the final function)
  const { prelude, briefs } = buildBriefs({ task, file: ctx.material.target.body, read: ctx.read });
  const last = briefs[briefs.length - 1]?.name;
  ctx.pre = async (reply, name, final, file) => {
    if (arm.key === 'H+fix' && final && !finalFiles.has(task.id)) finalFiles.set(task.id, { file, brief: briefs[briefs.length - 1], prelude });
    if (!arm.qexec || !final || name !== last) return { drop: false };
    const sp = spliceFunction(file, reply, name, task.target);
    if (!sp.ok) return { drop: false, verdict: 'not-run', why: sp.failClass };
    const q = await qExec(task, sp.body);
    log.push({ verdict: q.verdict, ms: q.ms, why: q.failures?.[0] ?? q.why ?? null });
    return { drop: q.verdict === 'fail', verdict: q.verdict, detail: q.failures?.[0] ?? q.why ?? null };
  };
  return run.strategies.blocks(arm, ctx);
};
async function partSampler() {
  const base = config.arms['H+fix'];
  config.arms['H+fix'] = { ...base, key: 'H+fix', strategy: 'qBlocks', pre: true };
  config.arms['Q-exec'] = { ...base, key: 'Q-exec', label: 'H+fix + QuickJS examples before tsc and the check (drop on fail)', strategy: 'qBlocks', pre: true, qexec: true };
  for (const armKey of ['H+fix', 'Q-exec']) {
    for (const task of TASKS) {
      const r = await run.runArm(armKey, task);
      const q = qLog.get(`${armKey}|${task.id}`) ?? [];
      rows.push({ ...r, q: armKey === 'Q-exec' ? { ran: q.length, dropped: q.filter((x) => x.verdict === 'fail').length, cantTell: q.filter((x) => x.verdict === 'cant-tell').length, ms: Math.round(sum(q.map((x) => x.ms))), log: q } : null });
      process.stderr.write(`${armKey} ${task.id}: ${r.pass ? 'pass' : `fail ${r.failClass}`} (${r.attempts} drawn)\n`);
    }
  }
}

// ------------------------------------------------------------------ part: census (every sample of the final function)
let S = null;
async function smithText(task, body, fn) {
  if (!S) S = await import('../../packages/engine/lsp/smith.mjs');
  if (!S.smithReady()) return null;
  const ref = fs.readFileSync(path.join(task.dir, 'reference', task.target), 'utf8');
  const want = (await S.smithIndexFile(task.target, ref, { canonical: true })).find((e) => e.name === fn);
  if (!want) return null;
  const got = await S.smithIndexFile(task.target, body, { canonical: true });
  const d = await S.smithDiagnostics({ [fn]: want.sentences }, got.filter((e) => e.name === fn));
  return !d.missing.length && !d.extra.length;
}
async function partCensus() {
  const out = [];
  for (const task of TASKS) {
    const ff = finalFiles.get(task.id);
    if (!ff) { out.push({ task: task.id, skipped: 'the H+fix setup never reached the final function' }); continue; }
    const ws = path.join(HERE, '.work', RUN, 'census', task.id);
    makeWorkspace(ws, task);
    const startBody = fs.readFileSync(path.join(ws, task.target), 'utf8');
    const arm = config.arms['H+fix'];
    for (let i = 0; i < arm.n; i++) {
      const body = JSON.stringify({ model: config.models[arm.coder], stream: false, keep_alive: config.ollama.keepAlive,
        options: { ...config.sampling[arm.sampling], seed: arm.seedBase + i }, messages: [{ role: 'system', content: config.prompts.functionCoderSystem }, { role: 'user', content: ff.brief.brief }] });
      const res = await globalThis.fetch(`${config.ollama.url}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      const reply = (await res.json()).message?.content ?? '';
      const sp = spliceFunction(ff.file, reply, ff.brief.name, task.target);
      if (!sp.ok) { out.push({ task: task.id, i, splice: sp.failClass }); continue; }
      const t0 = performance.now();
      const ev = run.evaluate(ws, task, startBody, { ok: true, body: sp.body }, { fixer: true });
      const judgeMs = performance.now() - t0;
      const qe = await qExec(task, sp.body);
      const qd = await qDiff(task, sp.body);
      const fixed = ev.fix?.changed ? fs.readFileSync(path.join(ws, task.target), 'utf8') : sp.body;
      const text = await smithText(task, fixed, ff.brief.name);
      out.push({ task: task.id, i, cached: replyCache.has(body), correct: ev.pass, failClass: ev.failClass, judgeMs: Math.round(judgeMs), qExec: qe.verdict, qExecMs: Math.round(qe.ms), qDiff: qd.verdict, qDiffWhy: qd.failures?.[0] ?? qd.why ?? null, text });
    }
  }
  notes.census = out;
}

// ------------------------------------------------------------------ report
function writeReport() {
  const L = [];
  const yes = (b) => (b ? 'yes' : 'no');
  L.push(`# QuickJS isolation ${RUN}`, '', `${new Date().toISOString().slice(0, 10)}. #947 (part of #941). ${QUICKJS_PACKAGE}, release-sync WebAssembly build. Coder ${config.models.coder}. Rows: \`${RUN}.jsonl\` (r1.jsonl's row format for the sampler setups, plus \`q\`); this page's other tables come from \`${RUN}.notes.json\`. Command: see q-run.mjs header.`, '');
  const cmp = fs.existsSync(path.join(RESULTS, 'q-compare.json')) ? JSON.parse(fs.readFileSync(path.join(RESULTS, 'q-compare.json'), 'utf8')) : null;
  if (cmp && want('compare')) {
    L.push('## 1-2. The QuickJS backend against the vm child', '', `\`bench/isolation/quickjs/compare.mjs\` (${cmp.at.slice(0, 16)}, node ${cmp.node}): the logicVerify isolated tests' cases as pairs (A), the isolation tasks' services, store functions and reference pages as units and as start->reference pairs (B). Warm = median of ${cmp.reps} calls per case; deterministic = ${cmp.det} identical results.`, '', ...cmp.table, '',
      `Cold, a fresh node process (median of 3): vm ${Math.round(cmp.cold.vm.importMs)} ms module load + ${Math.round(cmp.cold.vm.callMs)} ms first call; QuickJS ${Math.round(cmp.cold.quickjs.importMs)} ms + ${Math.round(cmp.cold.quickjs.callMs)} ms (the WebAssembly module loads on the first call).`, '',
      `Results that differ: ${cmp.diffs.length ? cmp.diffs.map((d) => `${d.group} ${d.name}`).join('; ') : 'none'}.`, '', '### Escape attempts (both sandboxes; host file, host prototypes and the next run checked after each)', '', ...cmp.escTable, '');
  }
  if (notes.plans) {
    const p = notes.plans;
    L.push('## 4. Q-plan: plan sketches on the spec examples', '', 'Sketches: `bench/isolation/plans/<task>.plan.js`, one per task, written from the goal and SPEC only (`view`), plus one deliberately wrong sketch each (`wrongView`). The examples are the task check\'s own fixture ids and expected strings (`quickjs/examples.mjs`). Each runs in a fresh QuickJS context.', '',
      `Right sketches pass: **${p.filter((x) => x.plan).length}/${p.length}**. Wrong sketches caught: **${p.filter((x) => x.wrongCaught).length}/${p.length}**.`, '', '| task | plan | wrong sketch caught | how it was caught |', '| --- | --- | --- | --- |',
      ...p.map((x) => `| ${x.task} | ${x.plan ? 'pass' : `**fail**: ${x.planWhy}`} | ${yes(x.wrongCaught)} | ${x.wrongWhy ?? '-'} |`), '');
  }
  if (notes.quick) {
    const q = notes.quick;
    L.push('### The 4 quick logic tasks: K2b and K5b sketches executed (inputs from exp/english-loop-chain fbce3355)', '', `Each sketch is transpiled and run in QuickJS on the task's check examples (\`chain/quick/tasks.mjs\` check). References: ${Object.entries(q.refs).map(([k, v]) => `${k} ${v}`).join(', ')}; mutants caught: ${Object.values(q.mutants).flat().filter((v) => v !== 'pass').length}/${Object.values(q.mutants).flat().length}.`, '',
      '| model | sketches | pass the examples | wrong (fail) | wrong that Smith text match accepted | right that text match rejected |', '| --- | --- | --- | --- | --- | --- |',
      ...Object.entries(q.k2b).map(([m, rs]) => `| ${m} | ${rs.length} | ${rs.filter((r) => r.exec === 'pass').length} | ${rs.filter((r) => r.exec !== 'pass').length} | ${rs.filter((r) => r.exec !== 'pass' && r.textMatch).length} | ${rs.filter((r) => r.exec === 'pass' && !r.textMatch).length} |`), '',
      'Per task (pass the examples / text match):', '', ...Object.entries(q.k2b).map(([m, rs]) => `- ${m}: ${[...new Set(rs.map((r) => r.task))].map((t) => { const x = rs.filter((r) => r.task === t); return `${t} ${x.filter((r) => r.exec === 'pass').length}/${x.length} exec, ${x.filter((r) => r.textMatch).length}/${x.length} text`; }).join('; ')}`), '',
      'K5b (the availability formatter end to end; the coder is always the 1.5b):', '', '| plan model | runs | Smith rule pass | plan sketch passes the examples | fill passes the examples |', '| --- | --- | --- | --- | --- |',
      ...Object.entries(q.k5b).map(([m, rs]) => `| ${m} | ${rs.length} | ${rs.filter((r) => r.textPass).length} | ${rs.filter((r) => r.sketchExec === 'pass').length} | ${rs.filter((r) => r.fillExec === 'pass').length} |`), '');
  }
  if (notes.refs) {
    const r = notes.refs;
    L.push('### Where Smith text match was wrong: references and r3 fills (K6) under Q-diff', '', 'K6 judged each task\'s reference and its r3 H+fix fill by Smith text against Claude-written Smith plans. Here the same files run in QuickJS: Q-exec on the examples, Q-diff against the plan sketch on every scenario (every fixture book, pick lists, pages, genres).', '',
      `References: Q-exec ${r.filter((x) => x.refExec === 'pass').length}/${r.length}, Q-diff ${r.filter((x) => x.refDiff === 'pass').length}/${r.length}; K6 text ${r.filter((x) => x.k6RefText).length}/${r.length}. Start files (must not pass Q-exec): ${r.filter((x) => x.startExec === 'pass').length}/${r.length} pass. r3 fills: r3 check ${r.filter((x) => x.r3Check).length}/${r.length}, Q-exec ${r.filter((x) => x.fillExec === 'pass').length}/${r.length}, Q-diff ${r.filter((x) => x.fillDiff === 'pass').length}/${r.length}; K6 text ${r.filter((x) => x.k6FillText).length}/${r.length}.`, '',
      '| task | ref Q-exec | ref Q-diff | ref K6 text | fill r3 check | fill Q-exec | fill Q-diff | fill K6 text | Q-diff note |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
      ...r.map((x) => `| ${x.task} | ${x.refExec} | ${x.refDiff} | ${x.k6RefText ? 'pass' : 'fail'} | ${x.r3Check ? 'pass' : 'fail'} | ${x.fillExec ?? '-'} | ${x.fillDiff ?? '-'} | ${x.k6FillText ? 'pass' : 'fail'} | ${(x.refDiff !== 'pass' ? `ref: ${x.refDiffWhy}` : x.fillDiff && x.fillDiff !== 'pass' ? `fill: ${x.fillDiffWhy}` : '').replace(/\|/g, '/').slice(0, 140)} |`), '');
  }
  const by = (a) => rows.filter((x) => x.arm === a);
  if (by('H+fix').length) {
    const h = by('H+fix'); const q = by('Q-exec');
    const judgeMs = (rs) => sum(rs.map((x) => x.wallMs - x.modelMs));
    const drawn = (rs) => sum(rs.map((x) => x.attempts ?? 0));
    const ran = sum(q.map((x) => x.q?.ran ?? 0)); const dropped = sum(q.map((x) => x.q?.dropped ?? 0)); const cant = sum(q.map((x) => x.q?.cantTell ?? 0));
    const finalSamples = sum(q.map((x) => x.sampleClasses?.length ?? 0));
    L.push('## 3. Q-exec in the sampler (H+fix best-of-5, paired draws)', '', 'Q-exec runs each candidate of the task\'s final function in QuickJS on the examples, before tsc and the check, and drops it on a failed example. A bundle that does not build or a ReferenceError (a missing import the importFixer may still add) is cant-tell and goes on to tsc. Both setups judge the same samples (the coder\'s replies are cached by prompt and seed).', '',
      '| setup | pass | samples drawn | non-model time (splice, Q-exec, workspace, tsc, fixer, check) | model time | fails |', '| --- | --- | --- | --- | --- | --- |',
      ...[['H+fix', h], ['Q-exec', q]].map(([a, rs]) => `| ${a} | ${rs.filter((x) => x.pass).length}/${rs.length} | ${drawn(rs)} | ${(judgeMs(rs) / 1000).toFixed(1)} s | ${(sum(h.map((x) => x.modelMs)) / 1000).toFixed(0)} s (first draw) | ${Object.entries(rs.filter((x) => !x.pass).reduce((m, x) => ({ ...m, [x.failClass]: (m[x.failClass] ?? 0) + 1 }), {})).map(([k, v]) => `${k} ${v}`).join(', ') || '-'} |`), '',
      `Final-function candidates run in QuickJS: ${ran} (of ${finalSamples} drawn; the rest did not splice). Dropped early: **${dropped}** (${ran ? Math.round((100 * dropped) / ran) : 0}% of those run), cant-tell ${cant}. QuickJS time: ${(sum(q.map((x) => x.q?.ms ?? 0)) / 1000).toFixed(2)} s in all (median ${Math.round(median(q.flatMap((x) => (x.q?.log ?? []).map((l) => l.ms))))} ms per candidate). Non-model time saved: ${((judgeMs(h) - judgeMs(q)) / 1000).toFixed(1)} s (${judgeMs(h) ? Math.round((100 * (judgeMs(h) - judgeMs(q))) / judgeMs(h)) : 0}%).`, '',
      '| task | H+fix | Q-exec | Q-exec per candidate (verdict: first reason) |', '| --- | --- | --- | --- |',
      ...h.map((x) => { const y = q.find((z) => z.task === x.task); return `| ${x.task} | ${x.pass ? 'pass' : `fail ${x.failClass}`} (${x.attempts}) | ${y ? `${y.pass ? 'pass' : `fail ${y.failClass}`} (${y.attempts})` : '-'} | ${(y?.q?.log ?? []).map((l) => `${l.verdict}${l.why ? `: ${String(l.why).slice(0, 60)}` : ''}`).join('; ').replace(/\|/g, '/') || '-'} |`; }), '');
  }
  if (notes.census) {
    const c = notes.census.filter((x) => x.correct !== undefined);
    const per = TASKS.map((t) => {
      const xs = c.filter((x) => x.task === t.id);
      const ok = xs.filter((x) => x.correct); const bad = xs.filter((x) => !x.correct);
      return { task: t.id, n: xs.length, correct: ok.length, textRejQdiffAcc: ok.filter((x) => x.text === false && x.qDiff === 'pass').length, qdiffCatchTextMiss: bad.filter((x) => x.text === true && x.qDiff === 'fail').length,
        qdiffRejCorrect: ok.filter((x) => x.qDiff === 'fail').length, qdiffAccWrong: bad.filter((x) => x.qDiff === 'pass').length, textAcc: xs.filter((x) => x.text === true).length, qexecDropCorrect: ok.filter((x) => x.qExec === 'fail').length,
        tscFail: bad.filter((x) => x.failClass === 'tsc').length, checkFail: bad.filter((x) => x.failClass === 'check').length };
    });
    const tot = (k) => sum(per.map((p) => p[k]));
    L.push('## 5. Q-diff: each candidate against the plan sketch, beside Smith text match and the check', '', 'Census: all 5 samples of each task\'s final function (same draws). correct = tsc clean and the task check passes (after the importFixer). Smith text match = the fill\'s canonical Smith sentences equal the reference\'s (lsp-r3 L-gate-canon). Q-diff = the candidate and the plan sketch show the same View on every scenario (pages: heading, lines, book links, buttons, selects, picks; never the JSX).', '',
      `Candidates: ${c.length} (${tot('correct')} correct). Correct fills text match rejects but Q-diff accepts: **${tot('textRejQdiffAcc')}**. Wrong fills Q-diff catches that text match misses: **${tot('qdiffCatchTextMiss')}**. Q-diff errors: ${tot('qdiffRejCorrect')} correct fills rejected, ${tot('qdiffAccWrong')} wrong fills accepted. Text match accepted ${tot('textAcc')}. Q-exec dropped ${tot('qexecDropCorrect')} correct fills.`, '',
      '| task | samples | correct | text rejects, Q-diff accepts (correct) | Q-diff catches, text accepts (wrong) | Q-diff rejects a correct fill | Q-diff accepts a wrong fill | wrong: tsc / check |', '| --- | --- | --- | --- | --- | --- | --- | --- |',
      ...per.map((p) => `| ${p.task} | ${p.n} | ${p.correct} | ${p.textRejQdiffAcc} | ${p.qdiffCatchTextMiss} | ${p.qdiffRejCorrect} | ${p.qdiffAccWrong} | ${p.tscFail} / ${p.checkFail} |`), '');
    const odd = c.filter((x) => (x.correct && x.qDiff === 'fail') || (!x.correct && x.qDiff === 'pass'));
    if (odd.length) L.push('Q-diff disagreements with the check:', '', ...odd.slice(0, 12).map((x) => `- ${x.task} sample ${x.i + 1}: check ${x.correct ? 'pass' : x.failClass}, Q-diff ${x.qDiff}${x.qDiffWhy ? ` (${x.qDiffWhy})` : ''}`), '');
  }
  fs.writeFileSync(path.join(RESULTS, `${RUN}.md`), L.join('\n'));
  fs.writeFileSync(path.join(RESULTS, `${RUN}.notes.json`), JSON.stringify(notes, null, 2));
  if (rows.length) fs.writeFileSync(path.join(RESULTS, `${RUN}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

if (want('plans')) await partPlans();
if (want('quick')) await partQuick();
if (want('refs')) await partRefs();
if (want('sampler')) await partSampler();
if (want('census') && finalFiles.size) await partCensus();
writeReport();
process.stderr.write(`wrote results/${RUN}.md\n`);
