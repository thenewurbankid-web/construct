#!/usr/bin/env node
// Driver CLI for the isolation harness (#941): lets a Claude agent drive qwen2.5-coder:1.5b on one task at a time,
// or write the code itself, with short machine-readable output (at most 40 lines per call; show-code prints whole
// starting files). Reuses config.mjs, lib/check-runner.mjs and blocks/{briefBuilder, spliceApplier, sampler}.
//
//   node bench/isolation/drive.mjs show <task>                          # SPEC excerpt + briefBuilder facts (no file)
//   node bench/isolation/drive.mjs show-code <task>                     # SPEC excerpt + full starting file(s)
//   node bench/isolation/drive.mjs try <task> --brief <file> [--run <id>] [--raw] [--fn <name>]  # note -> 1.5b body (prefilled, N<=5) -> splice -> tsc+check
//   node bench/isolation/drive.mjs check <task> --file <path> [--run <id>]  # tsc+check on a file Claude wrote, no model
//   node bench/isolation/drive.mjs summary --run <id>                   # per-task, per-arm table (+ claude-drive.sh sessions)
//
// `try` re-executes itself through packages/tools/dev/heavy.sh (one Ollama job machine-wide), so callers run it plainly.
// Log: results/claude-drive/<run>.jsonl (try = arm CD, try --raw = CD-raw, check = CW); sessions: results/claude-drive/<run>/<harness>-<arm>-<task>.json
// (harness-drive.sh). MCP: drive-mcp.mjs exposes show/show-code/try/check as task_* tools over stdio.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import * as config from './config.mjs';
import { buildBriefs } from './blocks/briefBuilder.mjs';
import { applyPrelude, spliceFunction } from './blocks/spliceApplier.mjs';
import { sample } from './blocks/sampler.mjs';
import { checkBrief } from './blocks/briefGuard.mjs';
import { STOP, fnGoal, chatmlPrompt, prefillFor, completeFunction } from './blocks/prefill.mjs';
import { signatures } from './lib/edit.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TASKS = join(HERE, 'tasks');
export const LOG_DIR = join(HERE, 'results', 'claude-drive');
const HEAVY = resolve(HERE, '../../packages/tools/dev/heavy.sh');
const TSC = createRequire(import.meta.url).resolve('typescript/bin/tsc');
const MAX_LINES = 40;
// Which harness is driving (set by harness-drive.sh through the MCP server's env); logged on every row.
const HARNESS = process.env.DRIVE_HARNESS || 'cli';
export const TRY_N = 5;

const out = (lines) => {
  const ls = lines.flatMap((l) => String(l).split('\n'));
  const cut = ls.length > MAX_LINES ? [...ls.slice(0, MAX_LINES - 1), `... (${ls.length - MAX_LINES + 1} more lines cut)`] : ls;
  process.stdout.write(cut.join('\n') + '\n');
};
const die = (msg, code = 2) => { process.stdout.write(`ERROR ${msg}\n`); process.exit(code); };

function loadTask(id) {
  if (!id || !/^t\d\d-[\w-]+$/.test(id) || !existsSync(join(TASKS, id, 'task.json'))) die(`unknown task "${id ?? ''}" (tasks: ${readdirSync(TASKS).filter((d) => /^t\d\d-/.test(d)).join(', ')})`);
  return { ...JSON.parse(readFileSync(join(TASKS, id, 'task.json'), 'utf8')), dir: join(TASKS, id) };
}

// ---------- workspace (same layout as run.mjs's makeWorkspace: _shared, then _r2, then the task's start/) ----------
function makeWorkspace(ws, task, override) {
  rmSync(ws, { recursive: true, force: true });
  mkdirSync(ws, { recursive: true });
  for (const d of [join(TASKS, '_shared'), join(TASKS, '_r2'), join(task.dir, 'start')]) if (existsSync(d)) cpSync(d, ws, { recursive: true });
  if (override != null) writeFileSync(join(ws, task.target), override);
  writeFileSync(join(ws, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2020', lib: ['dom', 'dom.iterable', 'esnext'], strict: true, noEmit: true, skipLibCheck: true,
      esModuleInterop: true, module: 'esnext', moduleResolution: 'bundler', resolveJsonModule: true, isolatedModules: true,
      jsx: 'react-jsx', types: [], paths: { 'next/link': ['./shims/next-link.tsx'] },
    },
    include: ['**/*.ts', '**/*.tsx'], exclude: ['.out'],
  }));
}
const startWorkspace = (task, tag) => {
  const ws = join(HERE, '.work', 'claude-drive', tag, task.id);
  makeWorkspace(ws, task);
  return { ws, read: (p) => readFileSync(join(ws, p), 'utf8') };
};

const exportsOf = (src) => [...src.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|class|type|interface)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);

// format -> fragment -> tsc -> check, same order as run.mjs's evaluate().
function evaluate(ws, task, startBody, body) {
  const missing = exportsOf(startBody).filter((n) => !exportsOf(body).includes(n));
  if (missing.length) return { pass: false, failClass: 'fragment', errors: [`missing export(s) ${missing.join(', ')}`] };
  makeWorkspace(ws, task, body);
  const t = spawnSync(process.execPath, [TSC, '-p', join(ws, 'tsconfig.json'), '--pretty', 'false'], { encoding: 'utf8', timeout: 120_000 });
  const tscErr = (t.stdout + t.stderr).split('\n').filter((l) => /error TS\d+/.test(l)).map((l) => l.replace(ws + '/', '').replace(relative(process.cwd(), ws) + '/', ''));
  if (t.status !== 0 || tscErr.length) return { pass: false, failClass: 'tsc', tscOk: false, errors: tscErr.length ? tscErr : [`tsc exited ${t.status}`] };
  const c = spawnSync(process.execPath, [join(HERE, 'lib/check-runner.mjs'), ws, task.dir], { encoding: 'utf8', timeout: 60_000 });
  let check;
  try { check = JSON.parse(c.stdout.trim().split('\n').pop()); } catch { check = { ok: false, failures: [`check runner crashed: ${(c.stderr || c.stdout || `status ${c.status}`).slice(0, 200)}`] }; }
  return check.ok ? { pass: true, failClass: null, tscOk: true, errors: [] } : { pass: false, failClass: 'check', tscOk: true, errors: check.failures };
}

const verdict = (ev, extra = '') => ev.pass
  ? [`PASS${extra}`]
  : [`FAIL ${ev.failClass}${extra}`, ...ev.errors.slice(0, 1).flatMap((e) => String(e).split('\n')).slice(0, 5).map((l) => `  ${l.slice(0, 300)}`)];

function logLine(run, row) {
  mkdirSync(LOG_DIR, { recursive: true });
  const prior = existsSync(join(LOG_DIR, `${run}.jsonl`))
    ? readFileSync(join(LOG_DIR, `${run}.jsonl`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((r) => r.task === row.task && r.arm === row.arm && (r.harness ?? 'cli') === HARNESS).length : 0;
  const full = { run, harness: HARNESS, ...row, attempt: prior + 1, at: new Date().toISOString() };
  appendFileSync(join(LOG_DIR, `${run}.jsonl`), JSON.stringify(full) + '\n');
  return full;
}

// briefBuilder's sections, by header, so `show` can print the facts without the current function body.
const sections = (brief) => Object.fromEntries(brief.split(/\n\n(?=[A-Z][A-Z ]+(?: \([^)]*\))?:)/).map((s) => {
  const m = s.match(/^([A-Z][A-Z ]+?)(?: \([^)]*\))?:\s?([\s\S]*)$/);
  return m ? [m[1], m[2]] : ['_', s];
}));

// ---------- commands ----------
function show(task) {
  const { ws, read } = startWorkspace(task, 'show');
  const { prelude, briefs } = buildBriefs({ task, file: read(task.target), read });
  const s = sections(briefs[0]?.brief ?? '');
  rmSync(ws, { recursive: true, force: true });
  out([
    `TASK ${task.id} (${task.kind}): ${task.goal}`,
    `SPEC:\n${task.spec.replace(/\n\s*\n/g, "\n")}`,
    `FILE: ${task.target}`,
    ...briefs.map((b) => `FUNCTION: ${b.name} (${b.exists ? 'exists, rewrite it' : 'new'})\nSIGNATURE: ${sections(b.brief).SIGNATURE}`),
    briefs.length > 1
      ? `ONE FUNCTION PER NOTE: call try once per function with fn set, in this order: ${briefs.map((b) => b.name).join(', ')}. A note must not name the other functions.`
      : `REPLY: the 1.5b writes only the body of ${briefs[0]?.name} (its signature is prefilled).`,
    `ALREADY AT THE TOP (prelude added by the harness):\n${(s['ALREADY AT THE TOP OF THE FILE'] ?? prelude.join('\n')).trim() || 'nothing'}`,
    s['TYPES IN SCOPE'] ? `TYPES IN SCOPE:\n${s['TYPES IN SCOPE'].split('\n').filter((l) => l.trim() && !/^\s*\/\*\*.*\*\/\s*$/.test(l)).join('\n')}` : 'TYPES IN SCOPE: none',
  ]);
}

function showCode(task) {
  const { ws, read } = startWorkspace(task, 'show');
  const fence = (p) => `File ${p}:\n\`\`\`${p.endsWith('.tsx') ? 'tsx' : 'ts'}\n${read(p).replace(/\n$/, '')}\n\`\`\``;
  const lines = [`TASK ${task.id} (${task.kind}): ${task.goal}`, `SPEC:\n${task.spec}`, `WRITE: ${task.target} (the complete file)`, fence(task.target),
    ...task.context.map((p) => `Read-only context ${p} (signatures):\n${signatures(p, read(p))}`)];
  rmSync(ws, { recursive: true, force: true });
  process.stdout.write(lines.join('\n') + '\n'); // whole starting files: exempt from the 40-line cap
}

// The 1.5b call: Ollama /api/generate with raw: true and the ChatML template applied here, the assistant turn
// prefilled with the signature + `{`, stopped at a column-0 `}`. Returns the completed function as a fenced reply.
async function prefilledCall({ system, user, signature, lang, seed }) {
  const model = config.models.coder;
  if (model === 'fable') throw new Error('model "fable" is not allowed');
  const t0 = Date.now();
  const prompt = chatmlPrompt({ system, user, prefill: prefillFor(signature, lang) });
  const res = await fetch(`${config.ollama.url}/api/generate`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(config.ollama.timeoutMs),
    body: JSON.stringify({ model, raw: true, stream: false, keep_alive: config.ollama.keepAlive, prompt,
      options: { ...config.sampling.qwen, seed, stop: STOP } }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return { reply: completeFunction(signature, j.response ?? '', lang), tokensIn: j.prompt_eval_count ?? 0, tokensOut: j.eval_count ?? 0,
    ms: Date.now() - t0, promptChars: prompt.length };
}

// The 1.5b prompt for one function: briefBuilder's brief with the TASK line narrowed to that function (fnGoal),
// plus the note (intent mode), or the note alone (raw mode). It never mentions the other target functions.
export function fnPrompt({ task, brief, names, note, raw }) {
  if (raw) return note;
  const own = brief.brief.replace(/^TASK: .*$/m, `TASK: ${fnGoal(task.goal, brief.name, names)}`);
  return `${own}\n\nLEAD'S NOTE: ${note.trim()}`;
}

// One function per request. The note (intent mode: added to briefBuilder's brief for that function as "LEAD'S
// NOTE"; raw mode: the whole 1.5b prompt) first passes briefGuard: intent only, and on a multi-function task it
// must not name the other target functions. A rejected note is logged as a try (failClass "brief").
// Multi-function tasks need --fn: that function's round runs on the file the earlier --fn rounds built (kept per
// run, harness, arm and task under results/claude-drive/state/), judged by tsc, or by tsc + check once every
// other function is done. Each sample is a prefilled body (prefilledCall), spliced strictly by name.
async function tryBrief(task, briefPath, run, raw = false, fn = null) {
  if (!briefPath || !existsSync(briefPath)) die(`--brief file not found: ${briefPath ?? ''}`);
  const note = readFileSync(briefPath, 'utf8');
  if (!note.trim()) die('the brief is empty');
  const t0 = Date.now();
  const arm = raw ? 'CD-raw' : 'CD';
  const { ws, read } = startWorkspace(task, run);
  const startBody = read(task.target);
  const { prelude, briefs } = buildBriefs({ task, file: startBody, read });
  const names = briefs.map((b) => b.name);
  if (fn && !names.includes(fn)) die(`fn "${fn}" is not a target function of ${task.id} (${names.join(', ')})`);
  const target = fn ?? (names.length === 1 ? names[0] : null);
  const base = { arm, cmd: 'try', mode: raw ? 'raw' : 'intent', task: task.id, ...(fn ? { fn } : {}), brief: relative(process.cwd(), briefPath), briefChars: note.length };
  const reject = (reason) => {
    const row = logLine(run, { ...base, rejected: reason, coderPromptChars: 0, coderCalls: 0, tokensIn: 0, tokensOut: 0,
      wallMs: Date.now() - t0, pass: false, failClass: 'brief', sampleClasses: [] });
    out([`FAIL brief (attempt ${row.attempt}, 0 1.5b calls: brief rejected)`, `  ${reason}`]);
  };
  if (!target) return reject(`this task has ${names.length} functions (${names.join(', ')}): call try once per function with fn set, one note per function.`);
  const guard = checkBrief(note, { fn: target, others: names });
  if (!guard.ok) return reject(guard.reason);

  const multi = names.length > 1;
  const stateFile = join(LOG_DIR, 'state', run, `${HARNESS}-${arm}-${task.id}.json`);
  const state = multi && existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, 'utf8')) : { file: applyPrelude(startBody, prelude, task.target), done: [] };
  const b = briefs.find((x) => x.name === target);
  const signature = sections(b.brief).SIGNATURE.trim();
  const lang = task.target.endsWith('.tsx') ? 'tsx' : 'ts';
  const user = fnPrompt({ task, brief: b, names, note, raw });
  const final = names.every((n) => n === target || state.done.includes(n));
  const calls = [];
  let res = null; let ev = null; let err = null;
  try {
    res = await sample({
      n: TRY_N, seedBase: 1,
      generate: async (seed) => { const c = await prefilledCall({ system: config.prompts.functionCoderSystem, user, signature, lang, seed }); calls.push(c); return c; },
      judge: (reply) => {
        const sp = spliceFunction(state.file, reply, target, task.target);
        if (!sp.ok) return { pass: false, tscOk: false, failClass: sp.failClass, ev: { pass: false, failClass: sp.failClass, errors: [sp.detail] } };
        const e = evaluate(ws, task, startBody, sp.body);
        const pass = final ? e.pass : e.tscOk === true;
        return { pass, tscOk: e.tscOk === true, failClass: pass ? null : e.failClass, ev: { ...e, pass, failClass: pass ? null : e.failClass }, body: sp.body };
      },
    });
    ev = res.picked.result.ev;
    if (res.picked.result.body) writeFileSync(join(ws, `candidate.${lang}`), res.picked.result.body);
  } catch (e) { err = String(e?.message ?? e); }
  if (err) ev = { pass: false, failClass: 'error', errors: [err] };
  if (multi && !ev.pass && !err) ev = { ...ev, errors: [`function ${target}: ${ev.errors?.[0] ?? ''}`] };
  let partial = null;
  if (multi && res?.pass) {
    const done = [...new Set([...state.done, target])];
    mkdirSync(dirname(stateFile), { recursive: true });
    writeFileSync(stateFile, JSON.stringify({ file: res.picked.result.body, done }));
    if (!final) partial = { done, left: names.filter((n) => !done.includes(n)) };
  }
  const classes = res?.samples.map((x) => x.failClass ?? 'pass') ?? [];
  const row = logLine(run, {
    ...base, coderPromptChars: Math.max(0, ...calls.map((c) => c.promptChars)), coderCalls: calls.length,
    tokensIn: calls.reduce((a, c) => a + c.tokensIn, 0), tokensOut: calls.reduce((a, c) => a + c.tokensOut, 0),
    wallMs: Date.now() - t0, pass: partial ? false : ev.pass, ...(multi ? { fnPass: Boolean(res?.pass) } : {}),
    failClass: partial ? null : ev.failClass, sampleClasses: classes,
  });
  const tail = ` (attempt ${row.attempt}, ${calls.length} 1.5b call(s), samples: ${classes.join(',') || '-'})`;
  out(partial
    ? [`OK ${target}: tsc clean, ${partial.done.length} of ${names.length} functions done${tail}`, `  next: try with fn ${partial.left[0]} (left: ${partial.left.join(', ')})`]
    : verdict(ev, tail));
}

function checkFile(task, filePath, run) {
  if (!filePath || !existsSync(filePath)) die(`--file not found: ${filePath ?? ''}`);
  const body = readFileSync(filePath, 'utf8');
  const t0 = Date.now();
  const { ws, read } = startWorkspace(task, run);
  const ev = evaluate(ws, task, read(task.target), body);
  const row = logLine(run, { arm: 'CW', cmd: 'check', task: task.id, file: relative(process.cwd(), filePath), writtenChars: body.length,
    coderCalls: 0, wallMs: Date.now() - t0, pass: ev.pass, failClass: ev.failClass });
  out(verdict(ev, ` (attempt ${row.attempt})`));
}

// ---------- summary: drive.mjs JSONL joined with claude-drive.sh's session records ----------
export function summarize(rows, sessions) {
  const h = (x) => x.harness ?? 'cli';
  const keys = [...new Set([...rows.map((r) => `${r.task}|${r.arm}|${h(r)}`), ...sessions.map((s) => `${s.task}|${s.arm}|${h(s)}`)])].sort();
  return keys.map((k) => {
    const [task, arm, harness] = k.split('|');
    const rs = rows.filter((r) => r.task === task && r.arm === arm && h(r) === harness);
    const s = sessions.find((x) => x.task === task && x.arm === arm && h(x) === harness);
    const last = rs[rs.length - 1];
    return {
      task, arm, harness, pass: rs.some((r) => r.pass), tries: rs.length, lastFail: last && !last.pass ? last.failClass : null,
      chars: rs.reduce((a, r) => a + (r.briefChars ?? r.writtenChars ?? 0), 0),
      coderCalls: rs.reduce((a, r) => a + (r.coderCalls ?? 0), 0), coderTokens: rs.reduce((a, r) => a + (r.tokensIn ?? 0) + (r.tokensOut ?? 0), 0),
      wallMs: rs.reduce((a, r) => a + (r.wallMs ?? 0), 0),
      claude: s ? { in: s.usage?.input_tokens ?? 0, out: s.usage?.output_tokens ?? 0, cacheRead: s.usage?.cache_read_input_tokens ?? 0,
        cacheWrite: s.usage?.cache_creation_input_tokens ?? 0, turns: s.num_turns ?? 0, cost: s.total_cost_usd ?? 0, ms: s.duration_ms ?? 0, model: s.model ?? '?' } : null,
    };
  });
}

// One harness session result -> the fields we keep. `claude -p --output-format json` gives usage/num_turns/total_cost_usd/
// duration_ms/modelUsage (model = the modelUsage key with the most output). harness-drive.sh writes other harnesses'
// results already in this shape (usage, num_turns, total_cost_usd, duration_ms, model).
export function sessionRecord(harness, arm, task, j) {
  const mu = j.modelUsage ?? {};
  const model = j.model ?? Object.keys(mu).sort((a, b) => (mu[b].outputTokens ?? 0) - (mu[a].outputTokens ?? 0))[0] ?? null;
  return { harness, arm, task, usage: j.usage ?? {}, num_turns: j.num_turns ?? 0, total_cost_usd: j.total_cost_usd ?? 0, duration_ms: j.duration_ms ?? 0,
    model, is_error: j.is_error ?? false, subtype: j.subtype ?? null };
}

// `opencode run --format json` event lines -> the session-record shape. Tokens and cost are summed over step-finish
// events (any event carrying `tokens`, if no step events exist); the model comes from providerID/modelID when reported.
export function normalizeOpencode(lines, { startMs = null, endMs = Date.now(), model = null } = {}) {
  const evs = lines.map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const found = [];
  const walk = (o, ev) => {
    if (!o || typeof o !== 'object') return;
    if (o.tokens && typeof o.tokens === 'object') found.push({ ev, tokens: o.tokens, cost: Number(o.cost) || 0 });
    for (const v of Object.values(o)) walk(v, ev);
  };
  evs.forEach((e) => walk(e, e));
  const steps = found.filter((f) => /step.?finish/i.test(f.ev.type ?? ''));
  const use = steps.length ? steps : found;
  const sum = (fn) => use.reduce((a, f) => a + (Number(fn(f.tokens)) || 0), 0);
  let seen = null;
  const findModel = (o) => { if (!o || typeof o !== 'object' || seen) return; if (o.modelID) { seen = `${o.providerID ? `${o.providerID}/` : ''}${o.modelID}`; return; } Object.values(o).forEach(findModel); };
  evs.forEach(findModel);
  const errors = evs.filter((e) => e.type === 'error').map((e) => e.error?.message ?? JSON.stringify(e.error ?? e).slice(0, 200));
  const ts = evs.map((e) => e.timestamp).filter(Number.isFinite);
  return {
    usage: { input_tokens: sum((t) => t.input), output_tokens: sum((t) => t.output) + sum((t) => t.reasoning),
      cache_read_input_tokens: sum((t) => t.cache?.read), cache_creation_input_tokens: sum((t) => t.cache?.write) },
    num_turns: steps.length || use.length, total_cost_usd: use.reduce((a, f) => a + f.cost, 0),
    duration_ms: startMs != null ? endMs - startMs : (ts.length ? Math.max(...ts) - Math.min(...ts) : 0),
    model: seen ?? model, is_error: errors.length > 0, errors, events: evs.length,
  };
}

// <harness>-<arm>-<task>.json; arms: CD (note mode), CD-raw (the brief is the whole prompt), CW (harness writes the file).
export const SESSION_FILE = /^(\w+)-(CD-raw|CD|CW)-(t\d\d-[\w-]+)\.json$/;

function summary(run) {
  const f = join(LOG_DIR, `${run}.jsonl`);
  const rows = existsSync(f) ? readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  const dir = join(LOG_DIR, run);
  const sessions = existsSync(dir) ? readdirSync(dir).filter((n) => SESSION_FILE.test(n)).flatMap((n) => {
    try { const [, harness, arm, task] = n.match(SESSION_FILE); return [sessionRecord(harness, arm, task, JSON.parse(readFileSync(join(dir, n), 'utf8')))]; } catch { return []; }
  }) : [];
  if (!rows.length && !sessions.length) die(`no records for run ${run} (${relative(process.cwd(), f)})`, 1);
  const t = summarize(rows, sessions);
  const k = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
  out([
    `run ${run}: ${t.length} task/arm rows, ${rows.length} drive calls, ${sessions.length} claude sessions`,
    'task                      harness  arm    pass tries chars 1.5b-calls 1.5b-tok wall-s | claude in/out/cacheR/cacheW turns cost$ model',
    ...t.map((r) => [r.task.padEnd(25), r.harness.padEnd(8), r.arm.padEnd(6), (r.pass ? 'PASS' : r.lastFail ?? 'FAIL').padEnd(4), String(r.tries).padStart(5), String(r.chars).padStart(5),
      String(r.coderCalls).padStart(10), k(r.coderTokens).padStart(8), (r.wallMs / 1000).toFixed(0).padStart(6), '|',
      r.claude ? `${k(r.claude.in)}/${k(r.claude.out)}/${k(r.claude.cacheRead)}/${k(r.claude.cacheWrite)} ${r.claude.turns} ${r.claude.cost.toFixed(3)} ${r.claude.model}` : '-'].join(' ')),
  ]);
}

// ---------- main ----------
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = (name, dflt) => { const i = rest.indexOf(`--${name}`); return i >= 0 ? rest[i + 1] : dflt; };
  const run = opt('run', process.env.DRIVE_RUN || 'default');
  if (!/^[\w.-]+$/.test(run)) die(`bad --run "${run}"`);
  const taskArg = rest[0]?.startsWith('--') ? null : rest[0];
  if (cmd === 'try' && !process.env.CONSTRUCT_HEAVY_HELD) {
    // One Ollama job at a time machine-wide: run this same command under heavy.sh (it may wait for the slot).
    const r = spawnSync(HEAVY, [process.execPath, fileURLToPath(import.meta.url), ...process.argv.slice(2)], { stdio: ['ignore', 'inherit', 'pipe'], encoding: 'utf8' });
    if (r.status !== 0 && r.stderr) process.stdout.write(r.stderr.split('\n').filter(Boolean).slice(-3).join('\n') + '\n');
    process.exit(r.status ?? 1);
  }
  if (cmd === 'show') show(loadTask(taskArg));
  else if (cmd === 'show-code') showCode(loadTask(taskArg));
  else if (cmd === 'try') await tryBrief(loadTask(taskArg), opt('brief'), run, rest.includes('--raw'), opt('fn', null));
  else if (cmd === 'check') checkFile(loadTask(taskArg), opt('file'), run);
  else if (cmd === 'summary') summary(run);
  else if (cmd === 'opencode-normalize') { // harness-drive.sh: <events.jsonl> <out.json> <startMs> <model label>
    const [ev, dest, start, model] = rest;
    const rec = normalizeOpencode(existsSync(ev) ? readFileSync(ev, 'utf8').split('\n').filter(Boolean) : [], { startMs: Number(start) || null, model });
    writeFileSync(dest, JSON.stringify(rec, null, 1) + '\n');
    out([`opencode session: ${rec.is_error ? `ERROR ${rec.errors[0]?.slice(0, 200)}` : 'ok'} turns ${rec.num_turns} model ${rec.model}`]);
  }
  else die('usage: drive.mjs show|show-code <task> | try <task> --brief <file> [--run id] | check <task> --file <path> [--run id] | summary --run <id>');
}
