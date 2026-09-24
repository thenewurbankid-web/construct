// #541 -- the per-verb wrappers on the executor seam (coreExecutor.mjs): one function per core activity, each
// running EITHER in-process (`engine`: the very same packages/core function the Cockpit endpoint has always
// called, through runCapturing) OR as the real `construct` binary (`cli`: `--format json`, only the JSON parsed),
// and returning the same result shape from both:
//
//   { mode, exitCode, report, doc }
//     report -- the verb's JSON document exactly as the CLI prints it (no trailing newline): the string the parity
//               contract compares byte for byte (test/executionModeVerbs.test.mjs)
//     doc    -- JSON.parse(report)
//
// The same RULE as coreExecutor.mjs holds: core activities only. Nothing here may be wired to a UI-helper
// endpoint (scope links, Palette, live-preview bridge, pane state, unit/flow/component read models).
//
// Both modes are given the SAME argv, so the only thing that can differ is the process boundary (cwd, env,
// stdout, exit code), which is exactly what the parity test pins.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { summarize, doctor } from '../../../packages/core/cli.mjs';
import { EXIT_CODES } from '../../../packages/core/diagnostics.mjs';
import { prHealth } from '../../../packages/engine/prHealth.mjs';
import { startTimer, elapsedSeconds } from '../../../packages/core/timing.mjs';
import { runCapturing } from './commandRunner.mjs';
import { ExecutionError, runCliVerb, parseJsonOutput } from './coreExecutor.mjs';

/**
 * Run one verb in the given mode with one argv and return the common result shape.
 *
 * @param {object} spec `{ mode, root, verb, argv, engineFn, what, okCodes?, check?, cli }`: `engineFn` is the
 *   packages/core function (called with `argv` plus `--dir root`), `cli` the options `runCliVerb` takes.
 * @returns {Promise<{mode:string, exitCode:number, report:string, doc:any}>}
 * @throws {ExecutionError} `ENGINE_FAILED` when the in-process call throws; the `cli` codes of coreExecutor otherwise.
 */
export async function runVerb({ mode, root, verb, argv, engineFn, what, okCodes = [0], check, cli = {} }) {
  if (mode === 'engine') {
    const r = await runCapturing(() => engineFn([...argv, '--dir', root]));
    if (!r.ok) throw new ExecutionError('ENGINE_FAILED', r.error);
    const report = r.output.join('\n');
    return { mode, exitCode: r.exitCode, report, doc: JSON.parse(report) };
  }
  if (mode !== 'cli') throw new ExecutionError('CLI_START_FAILED', `Unknown execution mode '${mode}'.`);
  const raw = await runCliVerb(root, [verb, ...argv], cli);
  const doc = parseJsonOutput(raw, { what, okCodes, check });
  return { mode, exitCode: raw.code, report: raw.stdout.replace(/\n$/, ''), doc };
}

/**
 * Does `construct summarize` have a `--format json` contract for this request? Only the default project/feature
 * summary does. The human views (`md`, `compact`, `prose`) and `since` (git-diff text that is not one JSON
 * document) have none, so the Cockpit serves those in-process in both modes.
 *
 * @param {{format?:string, since?:string}} [params] The request's `format` and `since` (both optional).
 * @returns {boolean} True when `cli` mode can serve it.
 */
export function summarizeHasJsonContract({ format, since } = {}) {
  return !since && (format === undefined || format === '' || format === 'json');
}

/**
 * `construct summarize [--feature <f>] --format json`: the deterministic project summary, an array with one entry
 * per feature (`packages/core/summarize.mjs`).
 *
 * @param {string} root Resolved project root.
 * @param {{mode?:'engine'|'cli', feature?:string, env?:NodeJS.ProcessEnv, bin?:string, timeoutMs?:number, spawnImpl?:Function}} [opts]
 * @returns {Promise<{mode:string, exitCode:number, report:string, doc:object[]}>}
 * @throws {ExecutionError} As `runVerb`.
 */
export function runSummarize(root, { mode = 'engine', feature, env, bin, timeoutMs, spawnImpl } = {}) {
  return runVerb({
    mode, root, verb: 'summarize', argv: ['--format', 'json', ...(feature ? ['--feature', feature] : [])],
    engineFn: summarize, what: 'a project summary (an array of features)',
    check: (doc) => (Array.isArray(doc) ? null : 'expected an array of feature summaries'),
    cli: { env, bin, timeoutMs, spawnImpl },
  });
}

/**
 * `construct doctor --format json`: node and npm versions, whether the project has an `architecture.yml`, and
 * which enforcer modules are installed.
 *
 * @param {string} root Resolved project root.
 * @param {{mode?:'engine'|'cli', env?:NodeJS.ProcessEnv, bin?:string, timeoutMs?:number, spawnImpl?:Function}} [opts]
 * @returns {Promise<{mode:string, exitCode:number, report:string, doc:object}>}
 * @throws {ExecutionError} As `runVerb`.
 */
export function runDoctor(root, { mode = 'engine', env, bin, timeoutMs, spawnImpl } = {}) {
  return runVerb({
    mode, root, verb: 'doctor', argv: ['--format', 'json'], engineFn: doctor, what: 'a doctor report',
    check: (doc) => (Array.isArray(doc.enforcers) && typeof doc.architectureYml === 'boolean' ? null : 'expected {node, npm, architectureYml, enforcers}'),
    cli: { env, bin, timeoutMs, spawnImpl },
  });
}

/**
 * Run a `cli`-mode verb and shape the outcome like `runCapturing` does (`{ok, output, attribution,
 * durationSeconds, httpStatus, ...}`), plus `mode`, so the Cockpit renders it exactly as it renders the in-process
 * path. A failure of the CLI itself (not found, timeout, non-success exit, output that is not the document) is an
 * `ok:false` result with the CLI's own words and HTTP 502, never an empty success.
 *
 * @param {() => Promise<{mode:string, exitCode:number, report:string, doc:any}>} run A verb runner from this file, already bound to its root and options.
 * @param {{lines?:(result:object)=>string[], attribution?:{tool:string, llm:string}|null}} [shape] `lines` turns the
 *   result into the `output` lines (default: the report split at newlines); `attribution` labels tool vs LLM work.
 * @returns {Promise<object>} The `runCapturing`-shaped result, with `mode: 'cli'`.
 */
export async function cliCommandResult(run, { lines, attribution = null } = {}) {
  const started = startTimer();
  try {
    const result = await run();
    return { ok: true, mode: 'cli', output: lines ? lines(result) : result.report.split('\n'), attribution, durationSeconds: elapsedSeconds(started), exitCode: result.exitCode, httpStatus: 200 };
  } catch (e) {
    if (!(e instanceof ExecutionError)) throw e;
    return { ok: false, mode: 'cli', output: [], attribution: null, durationSeconds: elapsedSeconds(started), error: e.message, httpStatus: 502 };
  }
}

const SAFE_REF = /^[0-9A-Za-z][0-9A-Za-z._/@^~-]*$/;

/**
 * `construct review <base> <head> [--plan <file>|--features a,b] [--no-merge-base] --format json`: the deterministic
 * PR-health report (`packages/engine/prHealth.mjs`). In `engine` mode this is `prHealth(...)` itself, the call the
 * Cockpit's review worker makes, printed the way the CLI prints it.
 *
 * `expected` (the declared scope) travels as the CLI's own `--features a,b` when it is a list of feature names, and
 * as a private temporary `--plan` file (removed afterwards) when it is an object (`{features, files}` or a plan).
 * The refs are checked here too: a ref that could be read as a flag is refused before anything runs.
 *
 * @param {string} root Resolved project root (must be its own nearest `architecture.yml` directory, see reviewCli.mjs).
 * @param {{mode?:'engine'|'cli', base:string, head:string, expected?:object|string[]|null, mergeBase?:boolean, env?:NodeJS.ProcessEnv, bin?:string, timeoutMs?:number, spawnImpl?:Function, signal?:AbortSignal, onStart?:(pid:number)=>void, graceMs?:number}} opts
 * @returns {Promise<{mode:string, exitCode:number, report:string, doc:object}>} `doc.ok` is false, with `doc.error`, for a refusal (unknown ref, not a repository).
 * @throws {ExecutionError} As `runVerb`, plus `CLI_START_FAILED` for a ref that is not a plain ref name.
 */
export async function runReview(root, { mode = 'engine', base, head, expected = null, mergeBase = true, env, bin, timeoutMs, spawnImpl, signal, onStart, graceMs } = {}) {
  for (const [label, ref] of [['base', base], ['head', head]]) {
    if (typeof ref !== 'string' || !SAFE_REF.test(ref)) throw new ExecutionError('CLI_START_FAILED', `The ${label} ref is not a plain ref name.`);
  }
  if (mode === 'engine') {
    const doc = prHealth(root, { base, head, expected, mergeBase });
    return { mode, exitCode: doc.ok ? 0 : doc.error?.code === 'INTERNAL_ERROR' ? EXIT_CODES.INTERNAL_ERROR : EXIT_CODES.USAGE_ERROR, report: JSON.stringify(doc, null, 2), doc };
  }
  if (mode !== 'cli') throw new ExecutionError('CLI_START_FAILED', `Unknown execution mode '${mode}'.`);
  let planDir = null;
  try {
    const scope = [];
    if (Array.isArray(expected)) {
      if (expected.length) scope.push('--features', expected.join(','));
    } else if (expected) {
      planDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-review-plan-'));
      const file = path.join(planDir, 'plan.json');
      fs.writeFileSync(file, JSON.stringify(expected), { mode: 0o600 });
      scope.push('--plan', file);
    }
    const argv = ['review', base, head, ...scope, ...(mergeBase ? [] : ['--no-merge-base']), '--format', 'json'];
    const raw = await runCliVerb(root, argv, { env, bin, timeoutMs, spawnImpl, signal, onStart, graceMs });
    const doc = parseJsonOutput(raw, {
      what: 'a PR-health report', okCodes: [0, EXIT_CODES.USAGE_ERROR, EXIT_CODES.INTERNAL_ERROR],
      check: (d, code) => (typeof d.ok !== 'boolean' ? 'no "ok" field' : (code === 0) !== d.ok ? `exit code ${code} disagrees with ok=${d.ok}` : null),
    });
    return { mode, exitCode: raw.code, report: raw.stdout.replace(/\n$/, ''), doc };
  } finally {
    if (planDir) fs.rmSync(planDir, { recursive: true, force: true });
  }
}
