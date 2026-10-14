// QuickJS backend for the isolated runner (isolatedRun.mjs `sandbox: 'quickjs'`). quickjs-emscripten 0.32.0 (MIT,
// WebAssembly, no native code; the release-sync variant). Same request and same result as the vm child
// (isolatedChild.cjs): `runQuickjsRequest(request, timeoutMs)` returns runChild's {timedOut, code, stdout, stderr} with
// stdout one JSON line {before: Run[], after: Run[]}, so isolatedPair / isolatedRun read both backends the same way.
//
// The sandbox: ONE QuickJS runtime per process (reused; recreated after an out-of-memory run), a FRESH context per run
// (each case of each side), disposed after. A context has no host API at all: no fs, no process, no require, no
// timers of the host; its only effectful globals are the recording fakes, which live inside the guest (guest.mjs,
// sliced from isolatedChild.cjs). Limits: a memory limit on the runtime (QUICKJS_MEMORY_BYTES), a max stack size, and
// an interrupt handler with a per-run deadline (min of the per-run limit and what is left of the request's time
// limit). Date is fixed at FAKE_ENV.now and Math.random is mulberry32(FAKE_ENV.seed), as on the vm path.
//
// Lower level, for other callers (bench/isolation Q-exec): `evalGuest(source, {timeoutMs})` runs one script in a fresh
// context of the same runtime, with no globals added, and returns {ok, value | error, timedOut, oom, ms}; a promise
// result is awaited by draining jobs.
import { getQuickJS, shouldInterruptAfterDeadline } from 'quickjs-emscripten';
import { guestBootstrap } from './guest.mjs';

/** The runtime's memory limit (all live contexts together; one is live at a time). */
export const QUICKJS_MEMORY_BYTES = 64 * 1024 * 1024;
/** QuickJS's own stack limit, well under the WebAssembly stack, so deep recursion throws instead of trapping. */
export const QUICKJS_STACK_BYTES = 256 * 1024;
/** The package and version, for reports. */
export const QUICKJS_PACKAGE = 'quickjs-emscripten@0.32.0 (MIT)';

let modulePromise = null;
let runtime = null;
let deadline = Infinity;

async function getRuntime() {
  modulePromise ??= getQuickJS();
  const QuickJS = await modulePromise;
  if (!runtime) {
    runtime = QuickJS.newRuntime();
    runtime.setMemoryLimit(QUICKJS_MEMORY_BYTES);
    runtime.setMaxStackSize(QUICKJS_STACK_BYTES);
    runtime.setInterruptHandler(() => Date.now() > deadline);
  }
  return runtime;
}

/** Drop the runtime (after an out-of-memory run its heap is not trusted); the next run makes a new one. */
function resetRuntime() {
  const rt = runtime;
  runtime = null;
  try { rt?.dispose(); } catch { /* a runtime with leaked objects asserts on dispose; it is dropped either way */ }
}

const isOom = (err) => /out of memory/i.test(String(err?.message ?? err));
const isInterrupt = (err) => /interrupted/i.test(String(err?.message ?? err));

/** Unwrap an evalCode/callFunction result: the handle, or throw the guest error as a plain object. */
function take(ctx, result) {
  if (result.error) {
    const e = ctx.dump(result.error);
    result.error.dispose();
    const err = new Error(typeof e === 'object' && e ? `${e.name ?? 'Error'}: ${e.message ?? ''}` : String(e));
    err.guest = e;
    throw err;
  }
  return result.value;
}

/**
 * Drive a guest promise to the end: run pending jobs; when none are left and the promise is still pending, resolve the
 * oldest queued macrotask (`drain`, when given) and go on. A promise that never settles returns {pending: true}.
 */
function settlePromise(rt, ctx, promise, drain) {
  for (let guard = 0; guard < 100000; guard++) {
    const jobs = rt.executePendingJobs();
    if (jobs.error) { const e = ctx.dump(jobs.error); jobs.error.dispose(); const err = new Error(`${e?.name ?? 'Error'}: ${e?.message ?? e}`); err.guest = e; throw err; }
    const st = ctx.getPromiseState(promise);
    if (st.type === 'fulfilled') return { value: st.value };
    if (st.type === 'rejected') { const e = ctx.dump(st.error); st.error.dispose(); const err = new Error(`${e?.name ?? 'Error'}: ${e?.message ?? e}`); err.guest = e; throw err; }
    if (!rt.hasPendingJob()) {
      if (!drain) return { pending: true };
      const r = take(ctx, ctx.callFunction(drain, ctx.undefined));
      const more = ctx.dump(r);
      r.dispose();
      if (!more && !rt.hasPendingJob()) return { pending: true };
    }
  }
  return { pending: true };
}

/**
 * One run (one case of one side) in a fresh context. Returns the guest's Run JSON object, or {fatal} for a time
 * limit / out of memory, or {pending: true} for a unit that never settles.
 */
async function runOne(side, args, env, until) {
  const rt = await getRuntime();
  const ctx = rt.newContext();
  const handles = [];
  const keep = (h) => { handles.push(h); return h; };
  deadline = until;
  try {
    take(ctx, ctx.evalCode(guestBootstrap(), 'line-guest.js')).dispose();
    const q = keep(take(ctx, ctx.evalCode('const q = globalThis.__lineQ; delete globalThis.__lineQ; q', 'line-take.js')));
    const fn = (name) => keep(ctx.getProp(q, name));
    const [setup, define, start, drain] = ['setup', 'define', 'start', 'drain'].map(fn);
    take(ctx, ctx.callFunction(setup, ctx.undefined, keep(ctx.newString(JSON.stringify(env))))).dispose();
    for (const [file, code] of Object.entries(side.modules)) {
      let modFn;
      try {
        modFn = take(ctx, ctx.evalCode(`(function (exports, require, module) {${code}\n})`, file));
      } catch (e) {
        // a module that does not parse throws at load, inside the run (the vm path's runInContext does the same)
        const name = e.guest?.name && /^[A-Z]\w*$/.test(e.guest.name) ? e.guest.name : 'SyntaxError';
        modFn = take(ctx, ctx.evalCode(`(function () { throw new ${name === 'SyntaxError' ? 'SyntaxError' : 'Error'}(${JSON.stringify(String(e.guest?.message ?? 'parse error'))}); })`, file));
      }
      keep(modFn);
      take(ctx, ctx.callFunction(define, ctx.undefined, keep(ctx.newString(file)), modFn)).dispose();
    }
    const meta = { entry: side.entry, fn: side.fn, resolved: side.resolved, missing: side.missing, blocks: side.blocks, runAs: side.runAs };
    const p = keep(take(ctx, ctx.callFunction(start, ctx.undefined, keep(ctx.newString(JSON.stringify(meta))), keep(ctx.newString(JSON.stringify(args))))));
    const done = settlePromise(rt, ctx, p, drain);
    if (done.pending) return { pending: true };
    const text = ctx.getString(done.value);
    done.value.dispose();
    return { run: JSON.parse(text) };
  } catch (e) {
    if (isInterrupt(e) || Date.now() > until) return { fatal: 'timeout' };
    if (isOom(e)) return { fatal: 'oom' };
    return { fatal: 'error', message: String(e?.message ?? e).split('\n')[0] };
  } finally {
    deadline = Infinity;
    for (const h of handles.reverse()) { try { if (h.alive) h.dispose(); } catch { /* already gone */ } }
    try { ctx.dispose(); } catch { /* an interrupted or out-of-memory context may hold leaked objects */ }
  }
}

/**
 * The QuickJS counterpart of isolatedRun.mjs runChild: the same request ({env, cases, before, after}), the same
 * result shape. Every case runs before then after, each in its own context; the time limit covers the whole request.
 * @param {{env: object, cases: unknown[][], before: object, after: object}} request
 * @param {number} timeoutMs
 * @param {{perRunMs?: number}} [opts]
 * @returns {Promise<{timedOut: boolean, code: number|null, stdout: string, stderr: string}>}
 */
export async function runQuickjsRequest(request, timeoutMs, { perRunMs = timeoutMs } = {}) {
  const end = Date.now() + timeoutMs;
  const out = { before: [], after: [] };
  for (const args of request.cases) {
    for (const key of ['before', 'after']) {
      const r = await runOne(request[key], args, request.env, Math.min(end, Date.now() + perRunMs));
      if (r.pending) return { timedOut: false, code: 0, stdout: '', stderr: '' };
      if (r.fatal === 'timeout') return { timedOut: true, code: null, stdout: '', stderr: '' };
      if (r.fatal === 'oom') { resetRuntime(); return { timedOut: false, code: 1, stdout: '', stderr: 'out of memory (QuickJS memory limit)' }; }
      // a host-side failure (the WebAssembly call itself threw): the runtime is not trusted after it
      if (r.fatal) { resetRuntime(); return { timedOut: false, code: 1, stdout: '', stderr: r.message ?? 'error' }; }
      out[key].push(r.run);
    }
  }
  return { timedOut: false, code: 0, stdout: `${JSON.stringify(out)}\n`, stderr: '' };
}

/**
 * Evaluate one script in a fresh context of the shared runtime (no globals added: no fakes, no host API). The script's
 * completion value is returned through JSON (a promise is awaited first).
 * @param {string} source
 * @param {{timeoutMs?: number, filename?: string}} [opts]
 * @returns {Promise<{ok: boolean, value?: unknown, error?: string, timedOut?: boolean, oom?: boolean, ms: number}>}
 */
export async function evalGuest(source, { timeoutMs = 2000, filename = 'guest.js' } = {}) {
  const t0 = performance.now();
  const ms = () => Math.round((performance.now() - t0) * 100) / 100;
  const rt = await getRuntime();
  const ctx = rt.newContext();
  deadline = Date.now() + timeoutMs;
  let h = null;
  let oom = false;
  try {
    h = take(ctx, ctx.evalCode(source, filename));
    let v = h;
    const st = ctx.getPromiseState(h);
    if (!st.notAPromise) { const s = settlePromise(rt, ctx, h, null); if (s.pending) return { ok: false, error: 'the promise never settled', ms: ms() }; v = s.value; }
    const j = ctx.dump(v);
    if (v !== h) v.dispose();
    return { ok: true, value: j, ms: ms() };
  } catch (e) {
    if (isInterrupt(e) || Date.now() > deadline) return { ok: false, timedOut: true, error: 'time limit', ms: ms() };
    if (isOom(e)) { oom = true; return { ok: false, oom: true, error: 'out of memory', ms: ms() }; }
    return { ok: false, error: String(e?.message ?? e).split('\n')[0], ms: ms() };
  } finally {
    deadline = Infinity;
    try { if (h?.alive) h.dispose(); } catch { /* gone */ }
    try { ctx.dispose(); } catch { /* leaked */ }
    if (oom) resetRuntime();
  }
}

/** Load the WebAssembly module and make the runtime now (for cold/warm measurements). */
export async function warmQuickjs() { await getRuntime(); }
