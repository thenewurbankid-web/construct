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
import { EXIT_CODES, ConstructError } from '../../../src/diagnostics.mjs';
import { startTimer, elapsedSeconds } from '../../../src/timing.mjs';
import { getSettings } from './settings.mjs';
import { serverLog } from './logBuffer.mjs';

const ATTRIBUTION_RE = /^\[tool: (.*)\] \[llm: (.*)\]$/;

let queue = Promise.resolve();

function serialize(fn) {
  const run = queue.then(fn, fn);
  // Swallow so one failed command doesn't wedge the queue for the next one.
  queue = run.then(() => undefined, () => undefined);
  return run;
}

/** Append `--dir <projectDir>` (the current settings' project directory) to
 * an argv array bound for a cli.mjs function — every one of create/
 * refactor/research/importCommand resolves its root via `getRoot(args)`,
 * which looks for `--dir` anywhere in the array. */
export function withDir(args) {
  const { projectDir } = getSettings();
  return projectDir ? [...args, '--dir', projectDir] : args;
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
 * rather than losing it. */
export async function runCapturing(fn) {
  return serialize(async () => {
    const totalStart = startTimer();
    const lines = [];
    const original = { log: console.log, warn: console.warn, error: console.error };
    const capture = (orig) => (...parts) => {
      lines.push(parts.map((p) => (typeof p === 'string' ? p : String(p))).join(' '));
      orig(...parts);
    };
    console.log = capture(original.log);
    console.warn = capture(original.warn);
    console.error = capture(original.error);

    let caught = null;
    const priorExitCode = process.exitCode;
    process.exitCode = undefined;
    try {
      await fn();
    } catch (e) {
      caught = e;
    } finally {
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
        httpStatus: EXIT_CODE_TO_HTTP[exitCode] ?? 500,
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
