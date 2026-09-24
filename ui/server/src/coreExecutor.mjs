// #541 -- the executor seam: WHICH implementation runs a core activity for the Cockpit.
//
//   engine  (default) -- call the packages/core + packages/engine function in-process, exactly as before.
//   cli               -- spawn the real `construct` binary as a subprocess (`validate --format json --dir <root>`),
//                        parse ONLY its JSON document, and treat anything else as a clear error.
//
// The mode is a per-project setting: `project.execution.mode` in architecture.yml (packages/core/config.mjs).
//
// RULE (do not break it): this seam is for CORE ACTIVITIES ONLY -- CLI-native verbs that have (or are getting)
// a stable `--format json` contract (validate today; create/refactor/import/summarize/research/review later).
// The Cockpit's UI-helper endpoints -- scope-links graph data, Palette grouping, the live-preview bridge,
// pane/resize state, the dev-server manager -- are high-frequency interaction plumbing and ALWAYS stay
// in-process regardless of the mode: a subprocess spawn on every hover or drag would make the UI feel broken,
// and there is no CLI verb for them to be equal to. Nothing in this file may be wired to those endpoints.
//
// Parity is enforced, not hoped for: test/executionModeParity.test.mjs runs the same fixtures through both
// modes and asserts byte-identical JSON.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aggregateValidation } from '../../../packages/core/registry.mjs';
import { formatReport } from '../../../packages/core/diagnostics.mjs';
import { loadConfig } from '../../../packages/core/config.mjs';
import { DEFAULT_ENFORCERS } from '../../../packages/engine/defaultEnforcers.mjs';

/** Env var naming the `construct` CLI to run in `cli` mode: a path to construct.mjs (source or the built
 * packages/cli/dist/construct.mjs). Absolute, or relative to the Cockpit server's working directory. */
export const CLI_BIN_ENV = 'CONSTRUCT_CLI_BIN';
/** Env var overriding the subprocess timeout, in milliseconds. */
export const CLI_TIMEOUT_ENV = 'CONSTRUCT_CLI_TIMEOUT_MS';
export const DEFAULT_CLI_TIMEOUT_MS = 120_000;
const MAX_OUTPUT_BYTES = 64 * 1024 * 1024;
const KILL_GRACE_MS = 2000;

/** A failure of the `cli` execution path, never a silent empty result. `code` is one of CLI_NOT_FOUND,
 * CLI_START_FAILED, CLI_TIMEOUT, CLI_FAILED (non-success exit), CLI_BAD_OUTPUT (not the JSON document). */
export class ExecutionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExecutionError';
    this.code = code;
  }
}

/**
 * Which `construct` binary `cli` mode runs. Order: the CONSTRUCT_CLI_BIN env var; else this repo's
 * packages/cli/construct.mjs (the monorepo layout); else an installed `@line/construct` package (how the split
 * Cockpit repo will consume it, #540 -- found by walking up from the server's own node_modules, its
 * `bin.construct` entry).
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {string} An absolute path to a file that exists.
 * @throws {ExecutionError} CLI_NOT_FOUND, naming every place that was looked at.
 */
export function resolveCliBin(env = process.env) {
  const tried = [];
  const fromEnv = env[CLI_BIN_ENV];
  if (fromEnv) {
    const abs = path.resolve(fromEnv);
    if (fs.existsSync(abs)) return abs;
    throw new ExecutionError('CLI_NOT_FOUND', `${CLI_BIN_ENV} points at ${abs}, which does not exist.`);
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  // 1. the monorepo layout (this file is ui/server/src/): the CLI beside it. Checked before node_modules on
  //    purpose -- a workspace symlink in node_modules can point at ANOTHER checkout of this repo.
  const inRepo = path.resolve(here, '..', '..', '..', 'packages', 'cli', 'construct.mjs');
  if (fs.existsSync(inRepo)) return inRepo;
  tried.push(inRepo);
  // 2. the split layout (#540): the CLI installed as a dependency of the Cockpit.
  for (const installed of ancestorDirs(here).map((d) => path.join(d, 'node_modules', '@line', 'construct'))) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(installed, 'package.json'), 'utf8'));
      const rel = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.construct;
      if (rel && fs.existsSync(path.join(installed, rel))) return path.join(installed, rel);
    } catch { /* not installed here */ }
    tried.push(installed);
  }
  throw new ExecutionError('CLI_NOT_FOUND', `The construct CLI was not found. Set ${CLI_BIN_ENV} to its construct.mjs, or install @line/construct. Looked in: ${tried.join(', ')}.`);
}

function ancestorDirs(start) {
  const out = [];
  for (let d = start; ; d = path.dirname(d)) {
    out.push(d);
    if (path.dirname(d) === d) return out;
  }
}

// What the subprocess sees: the variables a user's shell would give it, not the Cockpit server's whole
// environment (which holds tokens for the hosted instance). Same allow-list idea as packages/engine/testRunner.mjs's
// childEnv, plus every CONSTRUCT_* variable (CONSTRUCT_WORKSPACE_ROOT, CONSTRUCT_TEMPLATES_DIR, ...).
const SAFE_ENV = ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TMPDIR', 'SystemRoot', 'LOCALAPPDATA', 'NODE_PATH'];
function childEnv(env) {
  const out = { FORCE_COLOR: '0', NO_COLOR: '1' };
  for (const k of SAFE_ENV) if (env[k] !== undefined) out[k] = env[k];
  for (const [k, v] of Object.entries(env)) if (k.startsWith('CONSTRUCT_') && v !== undefined) out[k] = v;
  return out;
}

const clip = (s, n = 800) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Runs `node <bin> <args>` in `cwd`; resolves { code, stdout, stderr } or rejects with an ExecutionError. */
function runCli({ bin, args, cwd, env, timeoutMs, spawnImpl = spawn }) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      // argv array, no shell; own process group so a timeout stops the whole tree
      child = spawnImpl(process.execPath, [bin, ...args], { cwd, env: childEnv(env), stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    } catch (e) {
      return reject(new ExecutionError('CLI_START_FAILED', `The construct CLI could not be started: ${String(e.message || e)}`));
    }
    let stdout = '';
    let stderr = '';
    let bytes = 0;
    let stopping = null;
    let killer;
    const kill = (sig) => { try { process.kill(-child.pid, sig); } catch { try { child.kill(sig); } catch { /* gone */ } } };
    const stop = (why) => {
      if (stopping) return;
      stopping = why;
      kill('SIGTERM');
      killer = setTimeout(() => kill('SIGKILL'), KILL_GRACE_MS);
    };
    const take = (which) => (d) => {
      bytes += d.length;
      if (bytes > MAX_OUTPUT_BYTES) { stop('OVERFLOW'); return; }
      if (which === 'out') stdout += d; else stderr += d;
    };
    const timer = setTimeout(() => stop('TIMEOUT'), timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', take('out'));
    child.stderr.on('data', take('err'));
    child.once('error', (e) => {
      clearTimeout(timer); clearTimeout(killer);
      reject(new ExecutionError('CLI_START_FAILED', `The construct CLI could not be started: ${String(e.message || e)}`));
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer); clearTimeout(killer);
      if (stopping === 'TIMEOUT') return reject(new ExecutionError('CLI_TIMEOUT', `The construct CLI took longer than ${Math.round(timeoutMs / 1000)} seconds and was stopped.`));
      if (stopping === 'OVERFLOW') return reject(new ExecutionError('CLI_BAD_OUTPUT', 'The construct CLI produced more output than the Cockpit accepts and was stopped.'));
      resolve({ code, signal, stdout, stderr });
    });
  });
}

/**
 * The ONE way any core activity runs in `cli` mode (#541): `node <construct.mjs> <argv...> --dir <root>` with
 * `cwd` = the project root, the allow-listed environment (CONSTRUCT_* included), a timeout and a process-group
 * kill. `root` must be the server's own derived, contained project root (never a client string). Returns the raw
 * process result; each verb's parser decides what is a valid document.
 *
 * @param {string} root Resolved project root (the directory holding architecture.yml).
 * @param {string[]} argv The verb and its flags, WITHOUT `--dir` (appended here, last).
 * @param {{env?:NodeJS.ProcessEnv, bin?:string, timeoutMs?:number, spawnImpl?:Function}} [opts]
 * @returns {Promise<{code:number|null, signal:string|null, stdout:string, stderr:string}>}
 * @throws {ExecutionError} CLI_NOT_FOUND, CLI_START_FAILED, CLI_TIMEOUT, or CLI_BAD_OUTPUT (output overflow).
 */
export async function runCliVerb(root, argv, { env = process.env, bin, timeoutMs, spawnImpl } = {}) {
  const cliBin = bin ?? resolveCliBin(env);
  const limit = timeoutMs ?? (Number(env[CLI_TIMEOUT_ENV]) > 0 ? Number(env[CLI_TIMEOUT_ENV]) : DEFAULT_CLI_TIMEOUT_MS);
  return runCli({ bin: cliBin, args: [...argv, '--dir', root], cwd: root, env, timeoutMs: limit, spawnImpl });
}

/**
 * Parse a verb's `--format json` output. Only the JSON document is read, never the text form. The exit code must
 * be one of `okCodes` (a verb's own "this is a result" codes, e.g. 1 for "violations found"); every other exit,
 * unparseable output, or a document `check` rejects is an ExecutionError, never a silent empty result.
 *
 * @param {{code:number|null, signal?:string|null, stdout:string, stderr:string}} raw The process result.
 * @param {{what:string, okCodes?:number[], check?:(doc:any, code:number)=>string|null}} spec `what` names the document in
 *   messages; `check` returns a problem description, or null when the document has the expected shape.
 * @returns {any} The parsed document (an object or an array).
 * @throws {ExecutionError} CLI_FAILED for an unexpected exit, CLI_BAD_OUTPUT for anything that is not the document.
 */
export function parseJsonOutput({ code, signal = null, stdout, stderr }, { what, okCodes = [0], check }) {
  const detail = () => clip((stderr.trim() || stdout.trim()) || '(no output)');
  if (!okCodes.includes(code)) {
    throw new ExecutionError('CLI_FAILED', `The construct CLI exited with ${signal ? `signal ${signal}` : `code ${code}`}: ${detail()}`);
  }
  let doc;
  try { doc = JSON.parse(stdout); } catch {
    throw new ExecutionError('CLI_BAD_OUTPUT', `The construct CLI's output was not JSON (exit ${code}): ${detail()}`);
  }
  if (doc === null || typeof doc !== 'object') throw new ExecutionError('CLI_BAD_OUTPUT', `The construct CLI's JSON was not ${what} (exit ${code}): ${clip(stdout.trim())}`);
  const problem = check ? check(doc, code) : null;
  if (problem) throw new ExecutionError('CLI_BAD_OUTPUT', `The construct CLI's JSON was not ${what} (exit ${code}): ${problem}`);
  return doc;
}

/**
 * Parse `construct validate --format json` output. Only the JSON document is read, never the text form.
 * Exit 0 with status "passed" or exit 1 with status "failed" are the two success shapes (exit 1 means
 * "violations found", not "the CLI broke"); every other combination is an error.
 */
export function parseValidateOutput({ code, signal, stdout, stderr }) {
  const detail = () => clip((stderr.trim() || stdout.trim()) || '(no output)');
  if (code !== 0 && code !== 1) {
    throw new ExecutionError('CLI_FAILED', `The construct CLI exited with ${signal ? `signal ${signal}` : `code ${code}`}: ${detail()}`);
  }
  let doc;
  try { doc = JSON.parse(stdout); } catch {
    throw new ExecutionError('CLI_BAD_OUTPUT', `The construct CLI's output was not JSON (exit ${code}): ${detail()}`);
  }
  const shapeOk = doc && typeof doc === 'object' && (doc.status === 'passed' || doc.status === 'failed') && Array.isArray(doc.violations);
  if (!shapeOk) throw new ExecutionError('CLI_BAD_OUTPUT', `The construct CLI's JSON was not a validation report (exit ${code}): ${clip(stdout.trim())}`);
  if ((code === 0) !== (doc.status === 'passed')) {
    throw new ExecutionError('CLI_BAD_OUTPUT', `The construct CLI's exit code (${code}) disagrees with its report status "${doc.status}".`);
  }
  return doc;
}

/**
 * The execution mode a project asked for (`project.execution.mode`, default 'engine').
 *
 * @param {string} root Project root (holds architecture.yml).
 * @returns {'engine'|'cli'}
 * @throws A ConstructError naming the bad value when architecture.yml is unreadable or the value is unknown.
 */
export function resolveExecutionMode(root) {
  return loadConfig(root).project.execution.mode;
}

/**
 * Run `construct validate` for a project root in the given mode.
 *
 * @param {string} root Resolved project root (the directory holding architecture.yml).
 * @param {{mode?:'engine'|'cli', env?:NodeJS.ProcessEnv, bin?:string, timeoutMs?:number, spawnImpl?:Function}} [opts]
 * @returns {Promise<{mode:string, status:'passed'|'failed', ok:boolean, violations:object[], report:string}>}
 *   `report` is the JSON document exactly as `construct validate --format json` prints it (without the final
 *   newline) -- built by the same formatReport in engine mode -- so both modes can be compared byte for byte.
 * @throws {ExecutionError} In `cli` mode: not found, not started, timed out, non-success exit, or output that is not the report.
 */
export async function runValidate(root, { mode = 'engine', env = process.env, bin, timeoutMs, spawnImpl } = {}) {
  if (mode === 'engine') {
    const { violations, ok } = aggregateValidation(root, DEFAULT_ENFORCERS);
    return { mode, status: ok ? 'passed' : 'failed', ok, violations, report: formatReport(violations, { format: 'json' }) };
  }
  if (mode !== 'cli') throw new ExecutionError('CLI_START_FAILED', `Unknown execution mode '${mode}'.`);
  const raw = await runCliVerb(root, ['validate', '--format', 'json'], { env, bin, timeoutMs, spawnImpl });
  const doc = parseValidateOutput(raw);
  return { mode, status: doc.status, ok: doc.status === 'passed', violations: doc.violations, report: raw.stdout.replace(/\n$/, '') };
}
