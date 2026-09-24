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
import { summarize, doctor, create, refactor, importCommand } from '../../../packages/core/cli.mjs';
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
 * @param {{lines?:(result:object)=>string[], attribution?:{tool:string, llm:string}|null|((result:object)=>({tool:string, llm:string}|null))}} [shape]
 *   `lines` turns the result into the `output` lines (default: the report split at newlines); `attribution` (a value,
 *   or a function of the result) labels tool vs LLM work.
 * @returns {Promise<object>} The `runCapturing`-shaped result, with `mode: 'cli'`.
 */
export async function cliCommandResult(run, { lines, attribution = null } = {}) {
  const started = startTimer();
  try {
    const result = await run();
    // a verb's own refusal (`{ok:false, error}`, exit 2 or 3): the caller's mistake or the verb's failure, with its message
    if (result.doc && !Array.isArray(result.doc) && result.doc.ok === false) {
      const httpStatus = result.exitCode === EXIT_CODES.USAGE_ERROR ? 400 : 500;
      return { ok: false, mode: 'cli', output: [], attribution: null, durationSeconds: elapsedSeconds(started), exitCode: result.exitCode, error: result.doc.error?.message ?? 'The command failed.', httpStatus };
    }
    return { ok: true, mode: 'cli', output: lines ? lines(result) : result.report.split('\n'), attribution: typeof attribution === 'function' ? attribution(result) : attribution, durationSeconds: elapsedSeconds(started), exitCode: result.exitCode, httpStatus: 200 };
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

// ---- create / refactor / import: the verbs that WRITE files ---------------------------------------------------
//
// Each has a `--format json` document (`{ok: true, verb, ...}` or `{ok: false, error}` with the exit code) that is
// deterministic: no timings, paths relative to the project root. Only the deterministic forms have one; a request
// that asks for a model call (`--llm`, the Cockpit's "have the LLM write it" checkboxes) is never run through the
// subprocess: the provider keys live in the Cockpit server, the subprocess environment is allow-listed, and an LLM
// fill cannot be part of a byte-identical contract. The route serves those in-process and says so.

/**
 * The argv (without `--dir`) of `POST /api/create`'s three forms, or a 400 message.
 *
 * @param {{kind?:string, name?:string, feature?:string, layer?:string, layers?:string[]}} p The request fields.
 * @returns {{argv:string[]}|{error:string}} The verb's arguments, or why the request is refused.
 */
export function createArgv({ kind, name, feature, layer, layers } = {}) {
  if (kind === 'feature') return name ? { argv: ['feature', name] } : { error: 'name is required' };
  if (kind === 'layer') return name && feature && layers?.length ? { argv: ['layer', name, '--feature', feature, '--layers', layers.join(',')] } : { error: 'name, feature, and a non-empty layers[] are required' };
  if (kind === 'single') return name && feature && layer ? { argv: [layer, name, '--feature', feature] } : { error: 'name, feature, and layer are required' };
  return { error: 'kind must be "feature", "layer", or "single"' };
}

/**
 * The argv (without `--dir`) of `POST /api/refactor`'s two actions, or a 400 message.
 *
 * @param {{action?:string, name?:string, newName?:string, feature?:string, from?:string, to?:string, layer?:string}} p The request fields.
 * @returns {{argv:string[]}|{error:string}} The verb's arguments, or why the request is refused.
 */
export function refactorArgv({ action, name, newName, feature, from, to, layer } = {}) {
  if (action === 'move') return name && feature && from && to ? { argv: ['move', name, '--feature', feature, '--from', from, '--to', to] } : { error: 'name, feature, from, and to are required' };
  if (action === 'rename') return name && newName && feature && layer ? { argv: ['rename', name, newName, '--feature', feature, '--layer', layer] } : { error: 'name, newName, feature, and layer are required' };
  return { error: 'action must be "move" or "rename"' };
}

/**
 * The argv (without `--dir` or `--llm`) of `POST /api/import`'s two modes, or a 400 message. `resolveRead` maps a
 * file the server will read (`from`, `planPath`) to its contained absolute path, and may throw.
 *
 * @param {{mode?:string, name?:string, feature?:string, layers?:string[], from?:string, planPath?:string}} p The request fields.
 * @param {(value:string)=>string} [resolveRead] Containment for the two path fields (default: as given).
 * @returns {{argv:string[]}|{error:string}} The verb's arguments, or why the request is refused.
 */
export function importArgv({ mode, name, feature, layers, from, planPath } = {}, resolveRead = (v) => v) {
  if (mode === 'unit') return name && feature && layers?.length && from ? { argv: [name, '--feature', feature, '--layers', layers.join(','), '--from', resolveRead(from)] } : { error: 'name, feature, a non-empty layers[], and from are required' };
  if (mode === 'plan') return planPath ? { argv: ['--plan', resolveRead(planPath)] } : { error: 'planPath is required' };
  return { error: 'mode must be "unit" or "plan"' };
}

const WRITE_CODES = [0, EXIT_CODES.USAGE_ERROR, EXIT_CODES.INTERNAL_ERROR];
/** A `--format json` document of a file-writing verb: `ok` is a boolean and agrees with the exit code. */
const writeDocCheck = (verb) => (d, code) => (typeof d.ok !== 'boolean' ? 'no "ok" field' : (code === 0) !== d.ok ? `exit code ${code} disagrees with ok=${d.ok}` : d.ok && d.verb !== verb ? `expected a ${verb} document` : null);

function runWrite(verb, engineFn, what, root, argv, { mode = 'engine', env, bin, timeoutMs, spawnImpl } = {}) {
  return runVerb({ mode, root, verb, argv: [...argv, '--format', 'json'], engineFn, what, okCodes: WRITE_CODES, check: writeDocCheck(verb), cli: { env, bin, timeoutMs, spawnImpl } });
}

/**
 * `construct create feature|layer|<layer> ... --format json`: scaffold from templates, no model call.
 *
 * @param {string} root Resolved project root.
 * @param {{kind?:string, name?:string, feature?:string, layer?:string, layers?:string[]}} params As `createArgv`.
 * @param {{mode?:'engine'|'cli', env?:NodeJS.ProcessEnv, bin?:string, timeoutMs?:number, spawnImpl?:Function}} [opts]
 * @returns {Promise<{mode:string, exitCode:number, report:string, doc:object}>} `doc.ok` is false, with `doc.error`, for a refusal.
 * @throws {ExecutionError} `CLI_START_FAILED` for an invalid request; otherwise as `runVerb`.
 */
export function runCreate(root, params, opts) {
  const a = createArgv(params);
  if (a.error) throw new ExecutionError('CLI_START_FAILED', a.error);
  return runWrite('create', create, 'a create result', root, a.argv, opts);
}

/**
 * `construct refactor move|rename ... --format json`: the mechanical relocation plus the re-validation of the moved file.
 *
 * @param {string} root Resolved project root.
 * @param {{action?:string, name?:string, newName?:string, feature?:string, from?:string, to?:string, layer?:string}} params As `refactorArgv`.
 * @param {{mode?:'engine'|'cli', env?:NodeJS.ProcessEnv, bin?:string, timeoutMs?:number, spawnImpl?:Function}} [opts]
 * @returns {Promise<{mode:string, exitCode:number, report:string, doc:object}>} `doc.ok` is false, with `doc.error`, for a refusal.
 * @throws {ExecutionError} `CLI_START_FAILED` for an invalid request; otherwise as `runVerb`.
 */
export function runRefactor(root, params, opts) {
  const a = refactorArgv(params);
  if (a.error) throw new ExecutionError('CLI_START_FAILED', a.error);
  return runWrite('refactor', refactor, 'a refactor result', root, a.argv, opts);
}

/**
 * `construct import <name> --feature ... --from ...` or `--plan <path>`, `--format json`, without `--llm`.
 *
 * @param {string} root Resolved project root.
 * @param {{mode?:string, name?:string, feature?:string, layers?:string[], from?:string, planPath?:string}} params As `importArgv`; `from` and `planPath` must already be contained absolute paths.
 * @param {{mode?:'engine'|'cli', env?:NodeJS.ProcessEnv, bin?:string, timeoutMs?:number, spawnImpl?:Function}} [opts]
 * @returns {Promise<{mode:string, exitCode:number, report:string, doc:object}>} `doc.ok` is false, with `doc.error`, for a refusal.
 * @throws {ExecutionError} `CLI_START_FAILED` for an invalid request; otherwise as `runVerb`.
 */
export function runImport(root, params, opts) {
  const a = importArgv(params);
  if (a.error) throw new ExecutionError('CLI_START_FAILED', a.error);
  return runWrite('import', importCommand, 'an import result', root, a.argv, opts);
}
