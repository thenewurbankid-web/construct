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
import { makeWorkspace, runTsc } from './lib/workspace.mjs';
import { fixImports } from './blocks/importFixer.mjs';
import { spliceDeclarations, applySearchReplace, splitSkeleton, signatures } from './lib/edit.mjs';
import { buildBriefs } from './blocks/briefBuilder.mjs';
import { applyPrelude, spliceFunction } from './blocks/spliceApplier.mjs';
import { sample } from './blocks/sampler.mjs';

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

// ---------- workspace (lib/workspace.mjs) ----------
const readWs = (ws, p) => readFileSync(join(ws, p), 'utf8');

function runCheck(ws, task) {
  const r = spawnSync(process.execPath, [join(HERE, 'lib/check-runner.mjs'), ws, task.dir], { encoding: 'utf8', timeout: 60_000 });
  const line = r.stdout.trim().split('\n').pop();
  try { return JSON.parse(line); } catch { return { ok: false, failures: [`check runner crashed: ${(r.stderr || r.stdout || `status ${r.status}`).slice(0, 300)}`] }; }
}

const exportsOf = (src) => [...src.matchAll(/export\s+(?:default\s+)?(?:async\s+)?(?:function|const|let|class|type|interface)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1]);

// Evaluates one candidate file: format -> fragment -> tsc -> check.
// With opts.fixer (r3), importFixer runs after the edit lands and before the final tsc; the class the same candidate
// had without the fixer is kept as fix.preClass, and parsed.body becomes the fixed file (so a repair edits that).
function evaluate(ws, task, startBody, parsed, opts = {}) {
  if (!parsed.ok) return { pass: false, failClass: 'format', detail: parsed.detail, tsc: null, check: null };
  const missing = exportsOf(startBody).filter((n) => !exportsOf(parsed.body).includes(n));
  makeWorkspace(ws, task, parsed.body);
  let tsc = runTsc(ws);
  let check = runCheck(ws, task);
  const fragment = missing.length ? `fragment: missing export(s) ${missing.join(', ')}` : null;
  let fix = null;
  if (opts.fixer && !fragment) {
    const preClass = !tsc.ok ? 'tsc' : !check.ok ? 'check' : null;
    const r = fixImports(ws, task.target);
    fix = { changed: r.changed, preClass, log: r.log, unfixed: r.unfixed.slice(0, 8) };
    if (r.changed) { tsc = runTsc(ws); check = runCheck(ws, task); parsed.body = r.body; }
  }
  const failClass = fragment ? 'fragment' : !tsc.ok ? 'tsc' : !check.ok ? 'check' : null;
  return { pass: failClass === null, failClass, detail: fragment, tsc, check, fix };
}
const errorsText = (ev) => [
  ev.detail ? `- ${ev.detail}` : null,
  ...(ev.tsc?.errors ?? []).slice(0, 10).map((e) => `- tsc: ${e}`),
  ...(ev.check?.failures ?? []).map((f) => `- check: ${f}`),
].filter(Boolean).join('\n') || '- the reply did not contain a fenced code block with the file';

// ---------- models ----------
async function ollama(endpoint, modelKey, options, payload) {
  const model = config.models[modelKey];
  if (model === 'fable') throw new Error('model "fable" is not allowed');
  const t0 = Date.now();
  const res = await fetch(`${config.ollama.url}/api/${endpoint}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(config.ollama.timeoutMs),
    body: JSON.stringify({ model, stream: false, keep_alive: config.ollama.keepAlive, options, ...payload }),
  });
  if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
  const j = await res.json();
  return { model, reply: (endpoint === 'chat' ? j.message?.content : j.response) ?? '', tokensIn: j.prompt_eval_count ?? 0, tokensOut: j.eval_count ?? 0, ms: Date.now() - t0 };
}
// Every call is fresh and single-turn (system + one user message): no history is carried between calls.
const chat = (modelKey, options, system, user) => ollama('chat', modelKey, options, { messages: [{ role: 'system', content: system }, { role: 'user', content: user }] });
// FIM: Ollama's qwen2.5-coder template turns prompt + suffix into <|fim_prefix|>..<|fim_suffix|>..<|fim_middle|>.
const fim = (modelKey, options, prefix, suffix) => ollama('generate', modelKey, options, { prompt: prefix, suffix });

// Worker context: signature-only context files, dropped from the end while the prompt is over the budget.
function workerContext(arm, material, build) {
  if (!arm.coderContext || arm.coderContext === 'full') return material.context;
  let ctxFiles = arm.coderContext === 'none' ? [] : material.context.map((f) => ({ path: f.path, body: signatures(f.path, f.body) }));
  while (ctxFiles.length && config.approxTokens(build(ctxFiles)) > config.workerBudgetTokens) ctxFiles = ctxFiles.slice(0, -1);
  return ctxFiles;
}

// ---------- strategies ----------
// One brief -> up to N 1.5b samples (sampler block) -> spliceApplier -> tsc (+ the task check on the last function).
async function codeRound(arm, ctx, brief, file, final, label) {
  return sample({
    n: arm.n, seedBase: arm.seedBase,
    generate: (seed) => ctx.call('coder', arm.coder, config.prompts.functionCoderSystem, brief.brief, { seed }),
    judge: (reply, i) => {
      const t0 = Date.now();
      const sp = spliceFunction(file, reply, brief.name, ctx.material.task.target);
      if (!sp.ok) return { pass: false, tscOk: false, failClass: sp.failClass, ev: { pass: false, failClass: sp.failClass, detail: sp.detail }, ms: Date.now() - t0 };
      const ev = ctx.evaluate({ ok: true, body: sp.body }, `${label}-s${i + 1}`);
      const pass = final ? ev.pass : ev.tsc?.ok === true;
      return { pass, tscOk: ev.tsc?.ok === true, failClass: pass ? null : ev.failClass ?? 'tsc', ev, body: sp.body, ms: Date.now() - t0 };
    },
  });
}

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

  // E: one driver brief (B's prompt), up to N sampled whole-file edits through the shared sampler block.
  // Picker = first sample that passes tsc and the check; N=1/3/5 stats come from the same draw.
  async bestOfN(arm, ctx) {
    const instr = await ctx.call('driver', arm.driver, config.prompts.driverSystem, config.prompts.driver(ctx.material), { sampling: arm.driverSampling });
    const build = (c) => config.prompts.driven({ instruction: instr.reply, target: ctx.material.target, context: c });
    const user = build(workerContext(arm, ctx.material, build));
    const res = await sample({
      n: arm.n, seedBase: arm.seedBase,
      generate: (seed) => ctx.call('coder', arm.coder, config.prompts.coderSystem, user, { seed }),
      judge: (reply, i) => {
        const t0 = Date.now();
        const ev = ctx.evaluate(config.editFormats['whole-file'].parse(reply), i + 1);
        return { ev, pass: ev.pass, tscOk: ev.tsc?.ok === true && ev.failClass !== 'fragment', failClass: ev.failClass, ms: Date.now() - t0 };
      },
    });
    return { ...res.picked.result.ev, attempts: res.samples.length, nStats: res.stats(arm.reportN ?? [arm.n], instr.ms), sampleClasses: res.samples.map((x) => x.failClass ?? 'pass') };
  },

  // H: deterministic blocks, no driver model. briefBuilder -> 1.5b (sampler, N up to 5) -> spliceApplier.
  async blocks(arm, ctx) {
    const task = ctx.material.task;
    const { prelude, briefs } = buildBriefs({ task, file: ctx.material.target.body, read: ctx.read });
    let file = applyPrelude(ctx.material.target.body, prelude, task.target);
    let res; let drawn = 0;
    for (const [k, b] of briefs.entries()) {
      res = await codeRound(arm, ctx, b, file, k === briefs.length - 1, `f${k + 1}`);
      drawn += res.samples.length;
      if (!res.pass) break;
      file = res.picked.result.body;
    }
    const ev = res.picked.result.ev;
    return { ...ev, attempts: drawn, sampleClasses: res.samples.map((x) => x.failClass ?? 'pass'),
      ...(briefs.length === 1 ? { nStats: res.stats(arm.reportN ?? [arm.n], 0) } : {}), briefTokens: briefs.map((b) => b.approxTokens) };
  },

  // I: a small driver (qwen3:4b) calling native Ollama tools over the same blocks. Expected tool order:
  // brief -> code -> splice (-> brief/code/splice per extra function) -> check -> done; a failed check or code
  // round may go back to brief (a repair), at most `repairs` times. At most `maxTurns` driver turns.
  async toolDriver(arm, ctx) {
    const task = ctx.material.task;
    const start = buildBriefs({ task, file: ctx.material.target.body, read: ctx.read });
    const names = start.briefs.map((b) => b.name);
    const st = { file: applyPrelude(ctx.material.target.body, start.prelude, task.target), fn: 0, brief: null, candidate: null,
      repairs: 0, failed: false, done: false };
    const log = { turns: 0, nativeTurns: 0, toolCalls: 0, rightTool: 0, sequence: [], drawn: 0 };
    let expected = 'brief';
    const nextAfter = (tool, ok) => {
      if (tool === 'brief') return ok ? 'code' : (st.fn >= names.length ? 'check' : 'done');
      if (tool === 'code') return ok ? 'splice' : (st.repairs < arm.repairs ? 'brief' : 'done');
      if (tool === 'splice') return st.fn < names.length ? 'brief' : 'check';
      if (tool === 'check') return ok ? 'done' : (st.repairs < arm.repairs ? 'brief' : 'done');
      return 'done';
    };
    const exec = {
      async brief({ intent } = {}) {
        if (st.failed) {
          if (st.repairs >= arm.repairs) return { ok: false, text: 'Repair limit reached. Call done.' };
          st.repairs++; st.failed = false;
          if (st.fn >= names.length) st.fn = names.length - 1;
        }
        if (st.fn >= names.length) return { ok: false, text: 'Every function is written. Call check.' };
        const b = buildBriefs({ task, file: st.file, read: ctx.read, targetName: names[st.fn] }).briefs[0];
        st.brief = { ...b, brief: intent ? `${b.brief}\n\nLEAD'S NOTE: ${String(intent).slice(0, 1200)}` : b.brief };
        st.candidate = null;
        return { ok: true, text: `Brief ready for function ${b.name} (about ${config.approxTokens(st.brief.brief)} tokens). Next: code.` };
      },
      async code({ n } = {}) {
        if (!st.brief) return { ok: false, text: 'No brief yet. Call brief first.' };
        const last = st.fn === names.length - 1;
        const res = await codeRound({ ...arm, n: Math.max(1, Math.min(arm.n, Number(n) || arm.n)) }, ctx, st.brief, st.file, last, `r${st.repairs}f${st.fn + 1}`);
        log.drawn += res.samples.length;
        if (res.pass) { st.candidate = res.picked.result.body; return { ok: true, text: `Sample ${res.picked.i + 1} of ${res.samples.length} passed tsc${last ? ' and the task check' : ''}. Next: splice.` }; }
        st.failed = true;
        return { ok: false, text: `No sample passed (${res.samples.map((x) => x.failClass).join(', ')}). Last sample's problems:\n${errorsText(res.picked.result.ev)}` };
      },
      async splice() {
        if (!st.candidate) return { ok: false, text: 'Nothing to splice: no passing sample from code.' };
        st.file = st.candidate; st.candidate = null; st.brief = null;
        const name = names[st.fn]; st.fn++;
        return { ok: true, text: st.fn < names.length ? `Spliced ${name}. Next: brief for ${names[st.fn]}.` : `Spliced ${name}. Every function is written. Next: check.` };
      },
      async check() {
        const ev = ctx.evaluate({ ok: true, body: st.file }, `check${st.repairs}`);
        if (!ev.pass) st.failed = true;
        return { ok: ev.pass, text: ev.pass ? 'PASS: tsc is clean and the task check passed. Call done.' : `FAIL:\n${errorsText(ev)}` };
      },
      async done() { st.done = true; return { ok: true, text: 'Done.' }; },
    };
    const tools = [
      ['brief', 'Build the code-shaped brief for the next function to write (signature, types, spec line and a worked example, made by a deterministic block). Optional intent: extra instructions for the coder, e.g. the exact strings to show or the errors to fix.', { intent: { type: 'string', description: 'Extra instructions for the coder.' } }],
      ['code', 'Send the current brief to the coder model; it draws up to n samples (max 5) and keeps the first that passes.', { n: { type: 'integer', description: 'Samples to draw, 1-5.' } }],
      ['splice', "Put the coder's passing function into the file.", {}],
      ['check', 'Run tsc and the task check on the file.', {}],
      ['done', 'Finish.', {}],
    ].map(([name, description, properties]) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required: [] } } }));
    const messages = [
      { role: 'system', content: config.prompts.toolDriverSystem },
      { role: 'user', content: config.prompts.toolDriver(ctx.material) },
    ];
    while (!st.done && log.turns < arm.maxTurns) {
      const r = await ctx.chatTools(arm.driver, messages, tools);
      log.turns++;
      messages.push(r.message);
      const calls = r.message.tool_calls ?? [];
      if (!calls.length) { messages.push({ role: 'user', content: 'Call exactly one of the tools.' }); continue; }
      log.nativeTurns++;
      for (const c of calls) {
        const name = c.function?.name;
        log.toolCalls++;
        if (name === expected) log.rightTool++;
        log.sequence.push(name);
        const out = exec[name] ? await exec[name](c.function?.arguments ?? {}) : { ok: false, text: `Unknown tool ${name}.` };
        if (exec[name]) expected = nextAfter(name, out.ok);
        messages.push({ role: 'tool', tool_name: name, content: out.text });
        if (st.done) break;
      }
    }
    writeFileSync(join(ctx.rawDir, 'driver-transcript.json'), JSON.stringify(messages, null, 1));
    const ev = ctx.evaluate({ ok: true, body: st.file }, 'final');
    return { ...ev, attempts: log.drawn, toolLog: { ...log, nativeRate: log.turns ? log.nativeTurns / log.turns : 0, rightRate: log.toolCalls ? log.rightTool / log.toolCalls : 0, repairs: st.repairs, calledDone: st.done } };
  },

  // F / F-sr: code-shaped brief; the coder answers with a declaration (spliced by name) or SEARCH/REPLACE blocks.
  async codeShaped(arm, ctx) {
    const instr = await ctx.call('driver', arm.driver, config.prompts.codeShapedSystem, config.prompts.codeShaped(ctx.material));
    const prompt = arm.editFormat === 'splice' ? config.prompts.splice : config.prompts.searchReplace;
    const build = (c) => prompt({ instruction: instr.reply, target: ctx.material.target, context: c });
    const code = await ctx.call('coder', arm.coder, config.prompts.coderSystem.replace(/ Reply with[\s\S]*$/, ' Follow the reply format you are given exactly.'), build(workerContext(arm, ctx.material, build)));
    const body = ctx.material.target.body;
    return ctx.evaluate(arm.editFormat === 'splice' ? spliceDeclarations(body, code.reply) : applySearchReplace(body, code.reply), 1);
  },

  // G: the driver writes the file with one /*FILL*/ hole; the coder fills it by FIM (prefix + suffix, no chat).
  async fim(arm, ctx) {
    const sk = await ctx.call('driver', arm.driver, config.prompts.skeletonSystem, config.prompts.skeleton(ctx.material));
    const split = splitSkeleton(sk.reply);
    if (!split.ok) return ctx.evaluate({ ok: false, detail: split.detail }, 1);
    const mid = await ctx.fim(arm.coder, split.prefix, split.suffix);
    const middle = mid.reply.endsWith('\n') ? mid.reply : mid.reply + '\n';
    return ctx.evaluate({ ok: true, body: split.prefix + middle + split.suffix }, 1);
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
  const fixLog = [];
  const fixedClasses = [];
  const t0 = Date.now();
  const ctx = {
    material, rawDir,
    read: (p) => readWs(ws, p),
    async chatTools(modelKey, messages, tools) {
      const model = config.models[modelKey];
      if (model === 'fable') throw new Error('model "fable" is not allowed');
      const t0 = Date.now();
      const res = await fetch(`${config.ollama.url}/api/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(config.ollama.timeoutMs),
        body: JSON.stringify({ model, stream: false, think: arm.think, keep_alive: config.ollama.keepAlive, options: config.sampling[arm.driverSampling], messages, tools }),
      });
      if (!res.ok) throw new Error(`ollama ${res.status}: ${await res.text()}`);
      const j = await res.json();
      calls.push({ role: 'driver', model, tokensIn: j.prompt_eval_count ?? 0, tokensOut: j.eval_count ?? 0, ms: Date.now() - t0, promptApprox: 0 });
      return { message: j.message ?? { role: 'assistant', content: '' } };
    },
    async call(role, modelKey, system, user, over = {}) {
      const options = { ...config.sampling[over.sampling ?? (role === 'driver' ? arm.driverSampling : undefined) ?? arm.sampling], ...(over.seed != null ? { seed: over.seed } : {}) };
      const c = await chat(modelKey, options, system, user);
      calls.push({ role, model: c.model, tokensIn: c.tokensIn, tokensOut: c.tokensOut, ms: c.ms, promptApprox: config.approxTokens(system + user) });
      writeFileSync(join(rawDir, `${String(calls.length).padStart(2, '0')}-${role}.md`), c.reply);
      return c;
    },
    async fim(modelKey, prefix, suffix) {
      const c = await fim(modelKey, config.sampling[arm.sampling], prefix, suffix);
      calls.push({ role: 'coder', model: c.model, tokensIn: c.tokensIn, tokensOut: c.tokensOut, ms: c.ms, promptApprox: config.approxTokens(prefix + suffix) });
      writeFileSync(join(rawDir, `${String(calls.length).padStart(2, '0')}-coder-fim.md`), c.reply);
      return c;
    },
    evaluate(parsed, attempt) {
      const ev = evaluate(ws, task, startBody, parsed, { fixer: arm.fixer });
      if (ev.fix) { fixLog.push(...ev.fix.log); if (ev.fix.preClass !== (ev.failClass ?? null)) fixedClasses.push(`${ev.fix.preClass ?? 'pass'}->${ev.failClass ?? 'pass'}`); }
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
    coderPromptMax: Math.max(0, ...calls.filter((c) => c.role === 'coder').map((c) => c.promptApprox)),
    ...(ev.nStats ? { nStats: ev.nStats } : {}), ...(ev.sampleClasses ? { sampleClasses: ev.sampleClasses } : {}),
    ...(ev.toolLog ? { toolLog: ev.toolLog } : {}), ...(ev.briefTokens ? { briefTokens: ev.briefTokens } : {}),
    ...(arm.fixer ? { fix: ev.fix ?? null, fixesApplied: fixLog.length, fixedClasses: fixedClasses } : {}),
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
      wallMs: rs.reduce((x, r) => x + r.wallMs, 0), fails, coderPromptMax: Math.max(0, ...rs.map((r) => r.coderPromptMax ?? 0)) };
    const withN = rs.filter((r) => r.nStats);
    if (withN.length) summary[a].nStats = Object.fromEntries(Object.keys(withN[0].nStats).map((n) => [n, {
      pass: withN.filter((r) => r.nStats[n].pass).length, tscPickerPass: withN.filter((r) => r.nStats[n].tscPickerPass).length,
      wallMs: withN.reduce((x, r) => x + r.nStats[n].wallMs, 0), of: withN.length }]));
  }
  const meta = { run: runName, date: new Date().toISOString(), models: config.models, sampling: Object.fromEntries(armKeys.map((a) => [a, config.sampling[config.arms[a].sampling]])), arms: Object.fromEntries(armKeys.map((a) => [a, config.arms[a]])) };
  writeFileSync(join(RESULTS, `${runName}.json`), JSON.stringify({ meta, summary, rows }, null, 2) + '\n');
  writeFileSync(join(RESULTS, `${runName}.jsonl`), rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
  const cell = (r) => (r ? (r.pass ? `pass${r.attempts > 1 ? ` (try ${r.attempts})` : ''}` : r.failClass) : '-');
  const md = [
    `# Isolation ${runName}`, '',
    `${meta.date.slice(0, 10)}. Coder ${config.models.coder}, driver ${config.models.driver}. Rows: \`${runName}.jsonl\` (one line per arm and task, same order as below); raw replies and attempt files: \`${runName}-raw/<arm>/<task>/\`.`, '',
    '| Arm | | pass@1 | tokens in / out | wall | failures | max 1.5b prompt (approx tok) |', '| --- | --- | --- | --- | --- | --- | --- |',
    ...armKeys.map((a) => { const s = summary[a]; return `| ${a} | ${s.label} | ${s.pass}/${s.total} | ${s.tokensIn} / ${s.tokensOut} | ${(s.wallMs / 1000).toFixed(0)} s | ${Object.entries(s.fails).map(([k, v]) => `${k} ${v}`).join(', ') || '-'} | ${config.arms[a].model === 'driver' ? '-' : s.coderPromptMax} |`; }),
    ...armKeys.filter((a) => summary[a].nStats).flatMap((a) => ['', `Best-of-N, arm ${a} (same samples; wall = driver + samples up to the first pass; "tsc-only picker" = the first tsc-clean sample, judged by the check afterwards):`, '',
      '| N | pass (tsc+check picker) | pass (tsc-only picker) | wall |', '| --- | --- | --- | --- |',
      ...Object.entries(summary[a].nStats).map(([n, v]) => `| ${n} | ${v.pass}/${v.of} | ${v.tscPickerPass}/${v.of} | ${(v.wallMs / 1000).toFixed(0)} s |`), ...(summary[a].nStats[Object.keys(summary[a].nStats)[0]].of < summary[a].total ? ['', `(${summary[a].total - summary[a].nStats[Object.keys(summary[a].nStats)[0]].of} multi-function task(s) excluded from N stats: each function is sampled separately.)`] : [])]),
    ...armKeys.filter((a) => rows.some((r) => r.arm === a && r.toolLog)).flatMap((a) => {
      const rs = rows.filter((r) => r.arm === a && r.toolLog);
      const pct = (x) => `${Math.round(x * 100)}%`;
      const tot = rs.reduce((acc, r) => ({ turns: acc.turns + r.toolLog.turns, native: acc.native + r.toolLog.nativeTurns, calls: acc.calls + r.toolLog.toolCalls, right: acc.right + r.toolLog.rightTool }), { turns: 0, native: 0, calls: 0, right: 0 });
      return ['', `Tool-calling driver, arm ${a} (${config.models[config.arms[a].driver]}, sampling ${JSON.stringify(config.sampling[config.arms[a].driverSampling])}, think=${config.arms[a].think}). Native rate = driver turns with a native tool call / all turns; right-tool rate = calls matching the expected next tool (brief -> code -> splice -> check -> done, repairs back to brief) / all calls.`, '',
        '| Task | pass | native tool-call rate | right-tool rate | turns | sequence | wall | driver tokens in / out |', '| --- | --- | --- | --- | --- | --- | --- | --- |',
        ...rs.map((r) => `| ${r.task} | ${r.pass ? 'pass' : r.failClass} | ${pct(r.toolLog.nativeRate)} | ${r.toolLog.toolCalls ? pct(r.toolLog.rightRate) : '-'} | ${r.toolLog.turns} | ${r.toolLog.sequence.join(' ') || '-'}${r.toolLog.calledDone ? '' : ' (no done)'} | ${(r.wallMs / 1000).toFixed(0)} s | ${r.tokensByRole.driver.in} / ${r.tokensByRole.driver.out} |`),
        `| all | ${rs.filter((r) => r.pass).length}/${rs.length} | ${pct(tot.native / Math.max(1, tot.turns))} | ${pct(tot.right / Math.max(1, tot.calls))} | ${tot.turns} | | | |`];
    }),
    ...(() => {
      const withBase = armKeys.filter((a) => config.arms[a].baseline);
      if (!withBase.length) return [];
      const classes = (rs) => { const c = {}; for (const r of rs) if (!r.pass) c[r.failClass] = (c[r.failClass] ?? 0) + 1; return Object.entries(c).map(([k, v]) => `${k} ${v}`).join(', ') || '-'; };
      return ['', 'importFixer delta (same arm without the fixer = its baseline run; per-candidate = the same candidate file judged before and after the fixer):', '',
        '| Arm | baseline | baseline pass | with fixer | delta | gained | lost | failures before -> after | per-candidate class changes |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
        ...withBase.map((a) => {
          const { run, arm } = config.arms[a].baseline;
          let base = [];
          try { base = readFileSync(join(RESULTS, `${run}.jsonl`), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((r) => r.arm === arm); } catch {}
          const mine = rows.filter((r) => r.arm === a);
          const bp = base.filter((r) => r.pass).length, mp = mine.filter((r) => r.pass).length;
          const gained = mine.filter((r) => r.pass && !base.find((b) => b.task === r.task)?.pass).map((r) => r.task.slice(0, 3));
          const lost = mine.filter((r) => !r.pass && base.find((b) => b.task === r.task)?.pass).map((r) => r.task.slice(0, 3));
          const trans = {};
          for (const r of mine) for (const t of r.fixedClasses ?? []) trans[t] = (trans[t] ?? 0) + 1;
          return `| ${a} | ${run} ${arm} | ${bp}/${base.length} | ${mp}/${mine.length} | ${mp - bp >= 0 ? '+' : ''}${mp - bp} | ${gained.join(' ') || '-'} | ${lost.join(' ') || '-'} | ${classes(base)} -> ${classes(mine)} | ${Object.entries(trans).map(([k, v]) => `${k} x${v}`).join(', ') || '-'} |`;
        })];
    })(),
    '', `| Task | ${armKeys.join(' | ')} |`, `| --- | ${armKeys.map(() => '---').join(' | ')} |`,
    ...tasks.map((t) => `| ${t.id} | ${armKeys.map((a) => cell(rows.find((r) => r.arm === a && r.task === t.id))).join(' | ')} |`),
    '', 'pass = tsc clean and the task check passed. Fail classes, first failing stage wins: format (the reply did not yield a file: no fence, no SEARCH match, no FILL marker), fragment (a whole-file reply missing an export the file had: a fragment pasted as the file; r1 reported these under format), tsc, check. E\'s cell shows the first passing sample (try n of 5). C\'s pass counts whichever of its up to 3 attempts passed (try n). Tokens are Ollama prompt_eval_count / eval_count summed over every call of the arm (driver + coder). Wall time is per arm, summed over tasks, including checks.', '',
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
