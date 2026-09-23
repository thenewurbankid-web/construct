// Runs one of the core CLI's exported functions (create/refactor/research/
// importCommand from src/cli.mjs) and turns its console output into a
// structured result the frontend can render — in particular, splitting out
// the `[tool: ...] [llm: ...]` attribution line every create/refactor/
// research/import command ends with (see cli.mjs's `printAttribution`) so
// the UI can show tool-work vs llm-work distinctly instead of a generic
// success toast.
//
// These functions call plain `console.log`/`warn`/`error` and report their
// status through `setExitCode` (diagnostics.mjs), both written for one
// command per process. Here several run in one process, so (#569):
//
//   - commands are serialized PER LOGIN (`queues`): one user's long command
//     never delays another user's, while one user's own commands still run
//     one at a time in the order they were sent (key '' = no session / auth
//     off, which behaves exactly as the old single queue did);
//   - at most `CONSTRUCT_MAX_CONCURRENT_COMMANDS` (default 2) run at once
//     across all logins, so a room full of users cannot flood the machine;
//   - console is patched once for as long as any command is running, and a
//     line is kept only by the command whose async context printed it
//     (`commandContext`), so two commands' output never interleaves;
//   - the exit code is captured per command through `withExitCodeSink`,
//     never read from `process.exitCode`, which is shared.
import { AsyncLocalStorage } from 'node:async_hooks';
import { EXIT_CODES, ConstructError, withExitCodeSink } from '../../../packages/core/diagnostics.mjs';
import { startTimer, elapsedSeconds } from '../../../packages/core/timing.mjs';
import { getProjectDir } from './settings.mjs';
import { WorkspaceError, currentLogin } from './workspace.mjs';
import { serverLog } from './logBuffer.mjs';

const ATTRIBUTION_RE = /^\[tool: (.*)\] \[llm: (.*)\]$/;

// #413: no command may hold the queue forever. The model providers in
// src/llm.mjs bound their own calls (CONSTRUCT_LLM_TIMEOUT_SEC, default 300 s),
// so this is the outer guard: generous enough for a legitimate multi-step
// create/import with several model calls, finite so a provider added later
// without a timeout, or a hang anywhere else in a command, still cannot wedge
// every later Cockpit command until a restart.
export const DEFAULT_COMMAND_TIMEOUT_SEC = 900;

/** The per-command deadline in milliseconds: `CONSTRUCT_COMMAND_TIMEOUT_SEC` or the default. */
export function resolveCommandTimeoutMs(env = process.env) {
  const raw = Number(env.CONSTRUCT_COMMAND_TIMEOUT_SEC);
  const sec = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_COMMAND_TIMEOUT_SEC;
  return Math.round(sec * 1000);
}

// #569: how many commands may run at the same time across ALL logins. Two is
// the machine budget this repo already works to (CLAUDE.md: at most two heavy
// jobs at once on a 15 GB box); a bigger host raises it through the
// environment.
export const DEFAULT_MAX_CONCURRENT_COMMANDS = 2;

/** The global concurrency cap: `CONSTRUCT_MAX_CONCURRENT_COMMANDS` (a positive integer) or the default. */
export function resolveMaxConcurrentCommands(env = process.env) {
  const raw = Number(env.CONSTRUCT_MAX_CONCURRENT_COMMANDS);
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_MAX_CONCURRENT_COMMANDS;
}

export class CommandTimeoutError extends Error {
  constructor(ms) {
    super(`The command did not finish within ${Math.round(ms / 1000)} seconds and was abandoned (CONSTRUCT_COMMAND_TIMEOUT_SEC, default ${DEFAULT_COMMAND_TIMEOUT_SEC}). If it was waiting on a model, CONSTRUCT_LLM_TIMEOUT_SEC bounds that call.`);
    this.name = 'CommandTimeoutError';
  }
}

// ---- Per-login serialization (#569).

/** login key -> the tail of that login's command chain. An entry is dropped once its chain is idle, so the map
 * never accumulates logins that signed out. */
const queues = new Map();

/** Run `fn` after every earlier command of the CURRENT login has settled. Commands of different logins are
 * independent chains. The login is read now (the caller's request context), not when `fn` eventually starts. */
function serialize(fn) {
  const key = currentLogin();
  const prior = queues.get(key) ?? Promise.resolve();
  const run = prior.then(fn, fn);
  // Swallow so one failed command doesn't wedge the chain for the next one.
  const tail = run.then(() => undefined, () => undefined);
  queues.set(key, tail);
  tail.then(() => { if (queues.get(key) === tail) queues.delete(key); });
  return run;
}

// ---- Global concurrency cap (#569): a small FIFO counting semaphore.

let running = 0;
const waiting = [];

/** Resolves once a run slot is free (at most `limit` commands hold one). FIFO: a command that waited longer
 * starts first. */
function acquireSlot(limit) {
  if (running < limit) {
    running += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function releaseSlot() {
  running -= 1;
  const next = waiting.shift();
  if (next) {
    running += 1;
    next();
  }
}

/** How many commands hold a run slot right now (test seam). */
export function runningCommandCount() {
  return running;
}

// ---- Console capture, scoped per command (#413, #569).

// Which command a console line belongs to. The console patch is process-global, so a line printed by a command
// running at the same time as another (#569), or by a command abandoned at its deadline that later prints (#413),
// would otherwise land in whatever capture happened to be active. Every command runs inside its own async
// context carrying its own line list; a line is kept only by the command whose context printed it, and only
// while that command is still being captured.
const commandContext = new AsyncLocalStorage();

let captures = 0;
let originalConsole = null;

function keepLine(parts) {
  const store = commandContext.getStore();
  if (store?.open) store.lines.push(parts.map((p) => (typeof p === 'string' ? p : String(p))).join(' '));
}

/** Patch console for the first concurrent capture; every later one shares the patch. */
function beginCapture() {
  captures += 1;
  if (captures > 1) return;
  originalConsole = { log: console.log, warn: console.warn, error: console.error };
  const patch = (orig) => (...parts) => {
    keepLine(parts);
    orig(...parts);
  };
  console.log = patch(originalConsole.log);
  console.warn = patch(originalConsole.warn);
  console.error = patch(originalConsole.error);
}

/** Restore console once the last concurrent capture ends. */
function endCapture() {
  captures -= 1;
  if (captures > 0) return;
  console.log = originalConsole.log;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  originalConsole = null;
}

/** Resolve with `fn()`'s outcome, or reject with a CommandTimeoutError after `ms` — whichever comes first.
 * A late settlement of `fn()` is ignored. Never leaves a live timer behind. */
function withDeadline(fn, ms) {
  return new Promise((resolve, reject) => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; reject(new CommandTimeoutError(ms)); } }, ms);
    Promise.resolve().then(fn).then(
      (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } },
      (e) => { if (!done) { done = true; clearTimeout(timer); reject(e); } },
    );
  });
}

/** Append `--dir <projectDir>` (the current settings' project directory) to
 * an argv array bound for a cli.mjs function — every one of create/
 * refactor/research/importCommand resolves its root via `getRoot(args)`,
 * which looks for `--dir` anywhere in the array. */
export function withDir(args) {
  const projectDir = getProjectDir();
  // #365: with no project open there is nothing to run against. Never omit `--dir` (the CLI would then use the
  // server's own working directory).
  if (!projectDir) throw new WorkspaceError(409, 'NO_PROJECT', 'No project is open. Open a project from the workspace first.');
  return [...args, '--dir', projectDir];
}

const EXIT_CODE_TO_HTTP = {
  [EXIT_CODES.USAGE_ERROR]: 400,
  [EXIT_CODES.VIOLATIONS]: 200, // violations are a normal, successful report
  [EXIT_CODES.INTERNAL_ERROR]: 500,
};

/** Run `fn` (an async call into one of the wrapped cli.mjs functions),
 * capturing every console line it (or anything it calls) prints, and
 * return `{ ok, output, attribution, durationSeconds, error?, httpStatus }`.
 * `attribution` is `{ tool, llm }` parsed from the one `[tool: ...] [llm:
 * ...]` line the command printed, or null if none was found (shouldn't
 * normally happen for a successful create/refactor/research/import call,
 * but callers should not assume it's always present).
 *
 * `durationSeconds` (#167) is this call's own wall-clock total -- a floor
 * guarantee independent of whatever per-step timing text the command itself
 * may already have printed into `output` (see #165/#166): some commands
 * (research, refactor, a single non-slice create/generate) never print
 * their own "Total:" line, so the UI still needs a real number from
 * somewhere. Measured around the whole `fn()` call including a thrown
 * error, so a mid-command failure still reports accurate elapsed time
 * rather than losing it. Time spent waiting for an earlier command of the
 * same login, or for a free run slot, is not counted.
 *
 * `timeoutMs` (#413, default `resolveCommandTimeoutMs()`): a command that has
 * not settled by then is abandoned — its console capture and run slot are
 * released, the result is `{ok:false, httpStatus:504}` with a message naming
 * the timeout, and the login's queue moves on to the next command. Whatever
 * the abandoned command prints afterwards goes to the real console only,
 * never into any later or concurrent command's capture.
 *
 * `maxConcurrent` (#569, default `resolveMaxConcurrentCommands()`): the
 * command waits for one of that many global run slots before it starts. */
export async function runCapturing(fn, { timeoutMs = resolveCommandTimeoutMs(), maxConcurrent = resolveMaxConcurrentCommands() } = {}) {
  return serialize(async () => {
    await acquireSlot(maxConcurrent);
    const totalStart = startTimer();
    const store = { lines: [], open: true };
    const sink = { exitCode: undefined };
    beginCapture();

    let caught = null;
    try {
      await withDeadline(() => withExitCodeSink(sink, () => commandContext.run(store, fn)), timeoutMs);
    } catch (e) {
      caught = e;
    } finally {
      // Released exactly once, by whichever ended first — the command or the deadline. A late completion of an
      // abandoned command never reaches this block again; `open` false drops anything it still prints.
      store.open = false;
      endCapture();
      releaseSlot();
    }
    const { lines } = store;
    const exitCodeSet = sink.exitCode;

    // Feed the cockpit Logs tab (bounded ring buffer; see logBuffer.mjs).
    for (const line of lines) serverLog.record('command', 'info', line);
    if (caught) serverLog.record('command', 'error', `failed: ${caught.message}`);

    const output = [];
    let attribution = null;
    for (const line of lines) {
      const m = line.match(ATTRIBUTION_RE);
      if (m) attribution = { tool: m[1], llm: m[2] };
      else output.push(line);
    }
    const durationSeconds = elapsedSeconds(totalStart);

    if (caught) {
      const exitCode = caught instanceof ConstructError ? caught.exitCode : EXIT_CODES.INTERNAL_ERROR;
      return {
        ok: false,
        output,
        attribution,
        durationSeconds,
        error: caught.message,
        // 504: the command was abandoned at the deadline, not refused and not broken (#413).
        httpStatus: caught instanceof CommandTimeoutError ? 504 : (EXIT_CODE_TO_HTTP[exitCode] ?? 500),
      };
    }
    return {
      ok: true,
      output,
      attribution,
      durationSeconds,
      httpStatus: EXIT_CODE_TO_HTTP[exitCodeSet ?? EXIT_CODES.OK] ?? 200,
    };
  });
}
