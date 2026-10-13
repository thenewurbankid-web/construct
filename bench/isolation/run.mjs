#!/usr/bin/env node
// Small-model isolation harness (#941): runs each arm in config.mjs over the tasks in tasks/, checks every
// result deterministically (tsc + a jsdom check per task), and writes results/<run>.{json,jsonl,md}.
//
//   packages/tools/dev/heavy.sh node bench/isolation/run.mjs --run r1
//   node bench/isolation/run.mjs --run r1 --arms A --tasks t01-book-by-author     # a slice
//   node bench/isolation/run.mjs --selftest      # no model: start files must fail, reference/ must pass
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as config from './config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TASKS = join(HERE, 'tasks');
const RESULTS = join(HERE, 'results');
const require = createRequire(import.meta.url);
const TSC = require.resolve('typescript/bin/tsc');

const args = process.argv.slice(2);
const opt = (name, dflt) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : dflt; };
const runName = opt('run', 'r1');
const selftest = args.includes('--selftest');

const taskIds = (opt('tasks') ?? readdirSync(TASKS).filter((d) => /^t\d\d-/.test(d)).sort().join(',')).split(',');
const tasks = taskIds.map((id) => ({ ...JSON.parse(readFileSync(join(TASKS, id, 'task.json'), 'utf8')), dir: join(TASKS, id) }));

// ---------- workspace ----------
function makeWorkspace(ws, task, override) {
  rmSync(ws, { recursive: true, force: true });
  mkdirSync(ws, { recursive: true });
  cpSync(join(TASKS, '_shared'), ws, { recursive: true });
  cpSync(join(TASKS, '_r2'), ws, { recursive: true });
  if (existsSync(join(task.dir, 'start'))) cpSync(join(task.dir, 'start'), ws, { recursive: true });
  if (override != null) writeFileSync(join(ws, task.target), override);
  writeFileSync(join(ws, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2020', lib: ['dom', 'dom.iterable', 'esnext'], strict: true, noEmit: true, skipLibCheck: true,
      esModuleInterop: true, module: 'esnext', moduleResolution: 'bundler', resolveJsonModule: true, isolatedModules: true,
      jsx: 'react-jsx', types: [], paths: { 'next/link': ['./shims/next-link.tsx'] },
    },
    include: ['**/*.ts', '**/*.tsx'], exclude: ['.out'],
  }, null, 2));
}
const readWs = (ws, p) => readFileSync(join(ws, p), 'utf8');

function runTsc(ws) {
  const r = spawnSync(process.execPath, [TSC, '-p', join(ws, 'tsconfig.json'), '--pretty', 'false'], { encoding: 'utf8', timeout: 120_000 });
  const lines = (r.stdout + r.stderr).split('\n').filter((l) => /error TS\d+/.test(l)).map((l) => l.replace(ws + '/', ''));
  return { ok: r.status === 0 && lines.length === 0, errors: lines };
}

function runCheck(ws, task) {
  const r = spawnSync(process.execPath, [join(HERE, 'lib/check-runner.mjs'), ws, task.dir], { encoding: 'utf8', timeout: 60_000 });
  const line = r.stdout.trim().split('\n').pop();
  try { return JSON.parse(line); } catch { return { ok: false, failures: [`check runner crashed: ${(r.stderr || r.stdout || `status ${r.status}`).slice(0, 300)}`] }; }
}

const exportsOf = (src) => [...src.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|class|type|interface)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);

// Evaluates one candidate file: format -> fragment -> tsc -> check.
function evaluate(ws, task, startBody, parsed) {
  if (!parsed.ok) return { pass: false, failClass: 'format', detail: parsed.detail, tsc: null, check: null };
  const missing = exportsOf(startBody).filter((n) => !exportsOf(parsed.body).includes(n));
  makeWorkspace(ws, task, parsed.body);
  const tsc = runTsc(ws);
  const check = runCheck(ws, task);
  const fragment = missing.length ? `fragment: missing export(s) ${missing.join(', ')}` : null;
  const failClass = fragment ? 'format' : !tsc.ok ? 'tsc' : !check.ok ? 'check' : null;
  return { pass: failClass === null, failClass, detail: fragment, tsc, check };
}
const errorsText = (ev) => [
  ev.detail ? `- ${ev.detail}` : null,
  ...(ev.tsc?.errors ?? []).slice(0, 10).map((e) => `- tsc: ${e}`),
  ...(ev.check?.failures ?? []).map((f) => `- check: ${f}`),
].filter(Boolean).join('\n') || '- the reply did not contain a fenced code block with the file';

// ---------- models ----------
async function chat(modelKey, samplingKey, system, user) {
  const model = config.models[modelKey];
  if (model === 'fable') throw new Error('model "fable" is not allowed');
  const t0 = Date.now();
  const res = await fetch(`${config.ollama.url}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(config.ollama.timeoutMs),
    body: JSON.stringify({ model, stream: false, keep_alive: config.ollama.keepAlive, options: config.sampling[samplingKey],
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return { model, reply: j.message?.content ?? '', tokensIn: j.prompt_eval_count ?? 0, tokensOut: j.eval_count ?? 0, ms: Date.now() - t0 };
}

// ---------- strategies ----------
const strategies = {
  async direct(arm, ctx) {
    const call = await ctx.call('coder', arm.model, config.prompts.coderSystem, config.prompts.direct(ctx.material));
    return ctx.evaluate(config.editFormats[arm.editFormat].parse(call.reply), 1);
  },
  async driven(arm, ctx) {
    let instr = await ctx.call('driver', arm.driver, config.prompts.driverSystem, config.prompts.driver(ctx.material));
    let instruction = instr.reply;
    let base = ctx.material.target;
    let ev;
    for (let attempt = 1; attempt <= 1 + (arm.repairs ?? 0); attempt++) {
      if (attempt > 1) {
        instr = await ctx.call('driver', arm.driver, config.prompts.driverSystem, config.prompts.driverRepair({
          ...ctx.material, instruction, attemptBody: ev.parsed?.ok ? ev.parsed.body : null, errors: errorsText(ev) }));
        instruction = instr.reply;
        if (ev.parsed?.ok) base = { path: base.path, body: ev.parsed.body };
      }
      const code = await ctx.call('coder', arm.coder, config.prompts.coderSystem, config.prompts.driven({ instruction, target: base, context: ctx.material.context }));
      const parsed = config.editFormats[arm.editFormat].parse(code.reply);
      ev = { ...ctx.evaluate(parsed, attempt), parsed };
      if (ev.pass) break;
    }
    return ev;
  },
};

async function runArm(armKey, task) {
  const arm = config.arms[armKey];
  const ws = join(HERE, '.work', runName, armKey, task.id);
  makeWorkspace(ws, task);
  const startBody = readWs(ws, task.target);
  const material = {
    task, target: { path: task.target, body: startBody },
    context: task.context.map((p) => ({ path: p, body: readWs(ws, p) })),
  };
  const rawDir = join(RESULTS, `${runName}-raw`, armKey, task.id);
  rmSync(rawDir, { recursive: true, force: true });
  mkdirSync(rawDir, { recursive: true });
  const calls = [];
  const t0 = Date.now();
  const ctx = {
    material,
    async call(role, modelKey, system, user) {
      const sampKey = config.arms[armKey].sampling;
      const c = await chat(modelKey, sampKey, system, user);
      calls.push({ role, model: c.model, tokensIn: c.tokensIn, tokensOut: c.tokensOut, ms: c.ms });
      writeFileSync(join(rawDir, `${String(calls.length).padStart(2, '0')}-${role}.md`), c.reply);
      return c;
    },
    evaluate(parsed, attempt) {
      const ev = evaluate(ws, task, startBody, parsed);
      if (parsed.ok) writeFileSync(join(rawDir, `attempt-${attempt}.${task.target.split('.').pop()}`), parsed.body);
      return { ...ev, attempts: attempt };
    },
  };
  let ev;
  try {
    ev = await strategies[arm.strategy](arm, ctx);
  } catch (err) {
    ev = { pass: false, failClass: 'error', detail: String(err?.message ?? err), attempts: 0 };
  }
  const sum = (k, role) => calls.filter((c) => !role || c.role === role).reduce((a, c) => a + c[k], 0);
  return {
    run: runName, arm: armKey, armLabel: arm.label, task: task.id, pass: ev.pass, failClass: ev.failClass, detail: ev.detail ?? null,
    attempts: ev.attempts, tokensIn: sum('tokensIn'), tokensOut: sum('tokensOut'),
    tokensByRole: { driver: { in: sum('tokensIn', 'driver'), out: sum('tokensOut', 'driver') }, coder: { in: sum('tokensIn', 'coder'), out: sum('tokensOut', 'coder') } },
    modelMs: sum('ms'), wallMs: Date.now() - t0, calls: calls.length,
    tscErrors: ev.tsc?.errors?.slice(0, 8) ?? null, checkFailures: ev.check?.failures ?? null,
    raw: relative(HERE, rawDir),
  };
}

// ---------- selftest ----------
function runSelftest() {
  let bad = 0;
  for (const task of tasks) {
    const ws = join(HERE, '.work', 'selftest', task.id);
    makeWorkspace(ws, task);
    const startBody = readWs(ws, task.target);
    const s = evaluate(ws, task, '', { ok: true, body: startBody });
    const refPath = join(task.dir, 'reference', task.target);
    const r = existsSync(refPath) ? evaluate(ws, task, startBody, { ok: true, body: readFileSync(refPath, 'utf8') }) : null;
    const okStart = !s.pass && s.tsc.ok; // the start file compiles and fails its check
    const okRef = r?.pass === true;
    if (!okStart || !okRef) bad++;
    console.log(`${okStart && okRef ? 'ok  ' : 'FAIL'} ${task.id}  start: tsc=${s.tsc.ok} check=${s.check.ok}  reference: ${r ? `tsc=${r.tsc?.ok} check=${r.check?.ok} ${[r.detail, ...(r.tsc?.errors ?? []), ...(r.check?.failures ?? [])].filter(Boolean).join(' ; ')}` : 'missing'}`);
  }
  process.exit(bad ? 1 : 0);
}

// ---------- report ----------
function writeReport(rows, armKeys) {
  mkdirSync(RESULTS, { recursive: true });
  const summary = {};
  for (const a of armKeys) {
    const rs = rows.filter((r) => r.arm === a);
    const fails = {};
    for (const r of rs) if (!r.pass) fails[r.failClass] = (fails[r.failClass] ?? 0) + 1;
    summary[a] = { label: config.arms[a].label, pass: rs.filter((r) => r.pass).length, total: rs.length,
      tokensIn: rs.reduce((x, r) => x + r.tokensIn, 0), tokensOut: rs.reduce((x, r) => x + r.tokensOut, 0),
      wallMs: rs.reduce((x, r) => x + r.wallMs, 0), fails };
  }
  const meta = { run: runName, date: new Date().toISOString(), models: config.models, sampling: Object.fromEntries(armKeys.map((a) => [a, config.sampling[config.arms[a].sampling]])), arms: Object.fromEntries(armKeys.map((a) => [a, config.arms[a]])) };
  writeFileSync(join(RESULTS, `${runName}.json`), JSON.stringify({ meta, summary, rows }, null, 2) + '\n');
  writeFileSync(join(RESULTS, `${runName}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const cell = (r) => (r ? (r.pass ? `pass${r.attempts > 1 ? ` (try ${r.attempts})` : ''}` : r.failClass) : '-');
  const md = [
    `# Isolation ${runName}`, '',
    `${meta.date.slice(0, 10)}. Coder ${config.models.coder}, driver ${config.models.driver}. Rows: \`${runName}.jsonl\` (one line per arm and task, same order as below); raw replies and attempt files: \`${runName}-raw/<arm>/<task>/\`.`, '',
    '| Arm | | pass@1 | tokens in / out | wall | failures |', '| --- | --- | --- | --- | --- | --- |',
    ...armKeys.map((a) => { const s = summary[a]; return `| ${a} | ${s.label} | ${s.pass}/${s.total} | ${s.tokensIn} / ${s.tokensOut} | ${(s.wallMs / 1000).toFixed(0)} s | ${Object.entries(s.fails).map(([k, v]) => `${k} ${v}`).join(', ') || '-'} |`; }),
    '', `| Task | ${armKeys.join(' | ')} |`, `| --- | ${armKeys.map(() => '---').join(' | ')} |`,
    ...tasks.map((t) => `| ${t.id} | ${armKeys.map((a) => cell(rows.find((r) => r.arm === a && r.task === t.id))).join(' | ')} |`),
    '', 'pass = tsc clean and the task check passed. Fail classes, first failing stage wins: format (no usable fenced file, or a fragment missing an export the file had), tsc, check. C\'s pass counts whichever of its up to 3 attempts passed (try n). Tokens are Ollama prompt_eval_count / eval_count summed over every call of the arm (driver + coder). Wall time is per arm, summed over tasks, including checks.', '',
  ].join('\n');
  writeFileSync(join(RESULTS, `${runName}.md`), md);
  return summary;
}

// ---------- main ----------
if (selftest) runSelftest();
else {
  const armKeys = (opt('arms') ?? config.runs[runName]?.join(',') ?? '').split(',').filter(Boolean);
  if (!armKeys.length) { console.error(`no arms for run ${runName}`); process.exit(2); }
  const rows = [];
  for (const a of armKeys) {
    for (const task of tasks) {
      const row = await runArm(a, task);
      rows.push(row);
      console.log(`${runName} ${a} ${task.id}: ${row.pass ? 'pass' : `FAIL ${row.failClass}`}  ${row.tokensIn}/${row.tokensOut} tok  ${(row.wallMs / 1000).toFixed(1)} s`);
    }
  }
  const summary = writeReport(rows, armKeys);
  for (const [a, s] of Object.entries(summary)) console.log(`${a} ${s.label}: ${s.pass}/${s.total}`);
}
