#!/usr/bin/env node
// Driver CLI for the isolation harness (#941): lets a Claude agent drive qwen2.5-coder:1.5b on one task at a time,
// or write the code itself, with short machine-readable output (at most 40 lines per call; show-code prints whole
// starting files). Reuses config.mjs, lib/check-runner.mjs and blocks/{briefBuilder, spliceApplier, sampler}.
//
//   node bench/isolation/drive.mjs show <task>                          # SPEC excerpt + briefBuilder facts (no file)
//   node bench/isolation/drive.mjs show-code <task>                     # SPEC excerpt + full starting file(s)
//   node bench/isolation/drive.mjs try <task> --brief <file> [--run <id>] [--raw]  # brief -> 1.5b (N<=5) -> splice -> tsc+check
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
import { ts, parse, declName, isDirective, fencedBlocks, signatures } from './lib/edit.mjs';
import { makeWorkspace as sharedWorkspace } from './lib/workspace.mjs';

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

// ---------- workspace: the same one run.mjs builds (lib/workspace.mjs) ----------
const makeWorkspace = (ws, task, override) => sharedWorkspace(ws, task, override);
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
    `SPEC:\n${task.spec}`,
    `FILE: ${task.target}`,
    ...briefs.map((b) => `FUNCTION: ${b.name} (${b.exists ? 'exists, rewrite it' : 'new'})\nSIGNATURE: ${sections(b.brief).SIGNATURE}`),
    `ALREADY AT THE TOP (prelude added by the harness):\n${s['ALREADY AT THE TOP OF THE FILE'] ?? prelude.join('\n')}`,
    s['TYPES IN SCOPE'] ? `TYPES IN SCOPE:\n${s['TYPES IN SCOPE']}` : 'TYPES IN SCOPE: none',
    `REPLY: the 1.5b must return ${briefs.length > 1 ? `the functions ${briefs.map((b) => b.name).join(', ')}` : `only function ${briefs[0]?.name}`} in one fenced block.`,
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

// The reply's fenced block holds one or more target functions; each is spliced by name with spliceFunction.
function spliceReply(file, reply, names, path) {
  const blocks = fencedBlocks(reply);
  if (!blocks.length) return { ok: false, failClass: 'format', detail: /```/.test(reply) ? 'unclosed code fence' : 'no code fence' };
  const block = blocks.reduce((a, b) => (b.length > a.length ? b : a));
  const inc = parse(block, path);
  const fns = inc.statements.filter((st) => !ts.isImportDeclaration(st) && !isDirective(st));
  if (names.length === 1 || fns.length <= 1) return spliceFunction(file, reply, names.length === 1 ? names[0] : declName(fns[0]) ?? names[0], path);
  let body = file;
  for (const st of fns) {
    const name = declName(st);
    if (!names.includes(name)) return { ok: false, failClass: 'fragment', detail: `reply declares ${name ?? ts.SyntaxKind[st.kind]}, expected only ${names.join(', ')}` };
    const r = spliceFunction(body, `\`\`\`\n${st.getText(inc)}\n\`\`\``, name, path);
    if (!r.ok) return r;
    body = r.body;
  }
  return { ok: true, body };
}

async function chat(system, user, seed) {
  const model = config.models.coder;
  if (model === 'fable') throw new Error('model "fable" is not allowed');
  const t0 = Date.now();
  const res = await fetch(`${config.ollama.url}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(config.ollama.timeoutMs),
    body: JSON.stringify({ model, stream: false, keep_alive: config.ollama.keepAlive, options: { ...config.sampling.qwen, seed },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  return { reply: j.message?.content ?? '', tokensIn: j.prompt_eval_count ?? 0, tokensOut: j.eval_count ?? 0, ms: Date.now() - t0 };
}

// Two modes. intent (default, arm I's pattern): each function's briefBuilder brief plus the driver's text as
// "LEAD'S NOTE", one sampled round per function (earlier rounds judged by tsc, the last by tsc + check).
// raw (--raw): the driver's text is the whole 1.5b prompt; the reply may hold every target function at once.
async function tryBrief(task, briefPath, run, raw = false) {
  if (!briefPath || !existsSync(briefPath)) die(`--brief file not found: ${briefPath ?? ''}`);
  const brief = readFileSync(briefPath, 'utf8');
  if (!brief.trim()) die('the brief is empty');
  const t0 = Date.now();
  const { ws, read } = startWorkspace(task, run);
  const startBody = read(task.target);
  const { prelude, briefs } = buildBriefs({ task, file: startBody, read });
  const names = briefs.map((b) => b.name);
  let file = applyPrelude(startBody, prelude, task.target);
  const multiSystem = config.prompts.functionCoderSystem.replace('only the one function you are asked for, complete,', `only the functions you are asked for (${names.join(', ')}), complete,`);
  const rounds = raw
    ? [{ names, user: brief, system: names.length > 1 ? multiSystem : config.prompts.functionCoderSystem }]
    : briefs.map((b) => ({ names: [b.name], user: `${b.brief}\n\nLEAD'S NOTE: ${brief.trim()}`, system: config.prompts.functionCoderSystem }));
  const calls = []; const classes = [];
  let ev = null; let err = null;
  try {
    for (const [k, r] of rounds.entries()) {
      const final = k === rounds.length - 1;
      const res = await sample({
        n: TRY_N, seedBase: 1,
        generate: async (seed) => { const c = await chat(r.system, r.user, seed); calls.push({ ...c, promptChars: r.system.length + r.user.length }); return c; },
        judge: (reply) => {
          const sp = spliceReply(file, reply, r.names, task.target);
          if (!sp.ok) return { pass: false, tscOk: false, failClass: sp.failClass, ev: { pass: false, failClass: sp.failClass, errors: [sp.detail] } };
          const e = evaluate(ws, task, startBody, sp.body);
          const pass = final ? e.pass : e.tscOk === true;
          return { pass, tscOk: e.tscOk === true, failClass: pass ? null : e.failClass, ev: { ...e, pass, failClass: pass ? null : e.failClass }, body: sp.body };
        },
      });
      classes.push(...res.samples.map((x) => x.failClass ?? 'pass'));
      ev = res.picked.result.ev;
      if (res.picked.result.body) writeFileSync(join(ws, 'candidate.' + task.target.split('.').pop()), res.picked.result.body);
      if (!res.pass) { if (rounds.length > 1) ev = { ...ev, errors: [`function ${r.names[0]}: ${ev.errors?.[0] ?? ''}`] }; break; }
      file = res.picked.result.body;
    }
  } catch (e) { err = String(e?.message ?? e); }
  if (err) ev = { pass: false, failClass: 'error', errors: [err] };
  const row = logLine(run, {
    arm: raw ? 'CD-raw' : 'CD', cmd: 'try', mode: raw ? 'raw' : 'intent', task: task.id, brief: relative(process.cwd(), briefPath), briefChars: brief.length,
    coderPromptChars: Math.max(0, ...calls.map((c) => c.promptChars)), coderCalls: calls.length,
    tokensIn: calls.reduce((a, c) => a + c.tokensIn, 0), tokensOut: calls.reduce((a, c) => a + c.tokensOut, 0),
    wallMs: Date.now() - t0, pass: ev.pass, failClass: ev.failClass, sampleClasses: classes,
  });
  out(verdict(ev, ` (attempt ${row.attempt}, ${calls.length} 1.5b call(s), samples: ${classes.join(',') || '-'})`));
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
  else if (cmd === 'try') await tryBrief(loadTask(taskArg), opt('brief'), run, rest.includes('--raw'));
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
