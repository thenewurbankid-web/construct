// Runs one of the core CLI's exported functions (create/refactor/research/
// importCommand from src/cli.mjs) and turns its console output into a
// structured result the frontend can render — in particular, splitting out
// the `[tool: ...] [llm: ...]` attribution line every create/refactor/
// research/import command ends with (see cli.mjs's `printAttribution`) so
// the UI can show tool-work vs llm-work distinctly instead of a generic
// success toast.
//
// These functions call plain `console.log`/`warn`/`error` and expect to run
// once per process (some set `process.exitCode`); patching console is
// process-global, so command executions are serialized through one queue
// to keep concurrent requests from interleaving each other's captured
// output. For a local, single-user dev tool this is a fine trade-off.
import { AsyncLocalStorage } from 'node:async_hooks';
import { EXIT_CODES, ConstructError } from '../../../packages/core/diagnostics.mjs';
import { startTimer, elapsedSeconds } from '../../../packages/core/timing.mjs';
import { getProjectDir } from './settings.mjs';
import { WorkspaceError } from './workspace.mjs';
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

export class CommandTimeoutError extends Error {
  constructor(ms) {
    super(`The command did not finish within ${Math.round(ms / 1000)} seconds and was abandoned (CONSTRUCT_COMMAND_TIMEOUT_SEC, default ${DEFAULT_COMMAND_TIMEOUT_SEC}). If it was waiting on a model, CONSTRUCT_LLM_TIMEOUT_SEC bounds that call.`);
    this.name = 'CommandTimeoutError';
  }
}

let queue = Promise.resolve();

// Which command a console line belongs to (#413). The console patch is process-global, so a command abandoned
// at its deadline that later prints would otherwise land in whatever command is being captured at that moment.
// Every command runs inside its own async context; a capture keeps a line only when it was printed from inside
// the context of the command it is capturing for.
const commandContext = new AsyncLocalStorage();

function serialize(fn) {
  const run = queue.then(fn, fn);
  // Swallow so one failed command doesn't wedge the queue for the next one.
  queue = run.then(() => undefined, () => undefined);
  return run;
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
 * rather than losing it.
 *
 * `timeoutMs` (#413, default `resolveCommandTimeoutMs()`): a command that has
 * not settled by then is abandoned — console is restored, the result is
 * `{ok:false, httpStatus:504}` with a message naming the timeout, and the
 * queue moves on to the next command. Whatever the abandoned command prints
 * afterwards goes to the real console only, never into a later command's
 * capture. */
export async function runCapturing(fn, { timeoutMs = resolveCommandTimeoutMs() } = {}) {
  return serialize(async () => {
    const totalStart = startTimer();
    const lines = [];
    const original = { log: console.log, warn: console.warn, error: console.error };
    const token = Symbol('command');
    // Only lines printed from inside THIS command's async context are kept: a previous command abandoned at its
    // deadline may still print, and those lines go to the real console only (see `commandContext`).
    const capture = (orig) => (...parts) => {
      if (commandContext.getStore() === token) lines.push(parts.map((p) => (typeof p === 'string' ? p : String(p))).join(' '));
      orig(...parts);
    };
    console.log = capture(original.log);
    console.warn = capture(original.warn);
    console.error = capture(original.error);

    let caught = null;
    const priorExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await withDeadline(() => commandContext.run(token, fn), timeoutMs);
    } catch (e) {
      caught = e;
    } finally {
      // Restored exactly once, by whichever ended first — the command or the deadline. A late completion of an
      // abandoned command never reaches this block again.
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
    }
    const exitCodeSet = process.exitCode;
    process.exitCode = priorExitCode;

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
