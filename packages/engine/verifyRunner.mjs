// #632 (part of #616) -- the two read-only verification blocks of a plan, run and classified: `check.types` (`construct test types`) and
// `check.build` (`construct test build`). The same seam as `runProofs` (proofRunner.mjs): a plan step, the CLI and the Cockpit are this
// one function, the result is CLASSIFIED (packages/core/verify.mjs), never a raw log, and nothing is written in the project.
//   runTypesCheck(root, opts)   the project's own TypeScript (`tsc --noEmit -p`, the TYPE-001 block of type-check.mjs) -> pass, or errors
//                               grouped by file with the first N (file, line, code, kind, message) and a plain statement
//   runBuildCheck(root, opts)   the project's `build` script through a BOUNDED child process (a timeout that kills the whole process
//                               group, an output cap) -> pass | compile-error | missing-script | timeout | failed
//   renderCheckText(result)     the result as text for a terminal
//   checkExitCode(result)       0 for a pass, 1 when the check found a problem, 2 when it could not run
// Resolves, never rejects. Deterministic, no model, no network of its own.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { runTypeCheckDetailed } from '../core/type-check.mjs';
import { loadConfig } from '../core/config.mjs';
import { walk } from '../core/fs.mjs';
import { classifyFailure } from './testRunner.mjs';
import { classifyTypeErrors, classifyBuildOutput, buildScriptOf, VERIFY_LIMITS, VERIFY_TIMEOUTS } from '../core/verify.mjs';

const SAFE_ENV = ['PATH', 'HOME', 'USER', 'LANG', 'LC_ALL', 'TMPDIR', 'SystemRoot', 'APPDATA', 'npm_config_cache'];
const FEATURE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const COULD_NOT_RUN = /^TYPE-001 could not run: /;
const TS_MESSAGE = /^(TS\d+): (.*)$/s;

const fail = (code, message) => ({ ok: false, error: { code, message } });

/** Every `*.tsbuildinfo` file under the project (a project with `incremental` makes `tsc --noEmit` write one), as a set of absolute paths. */
const buildInfoFiles = (root) => new Set(walk(root).filter((f) => f.endsWith('.tsbuildinfo')));

/** The reason a type-check could not run -> its status. */
function couldNotRunStatus(reason) {
  if (/TypeScript is not installed/.test(reason)) return 'tool-missing';
  if (/no .* found in the project/.test(reason)) return 'no-config';
  if (/did not finish within/.test(reason)) return 'timeout';
  return 'failed';
}

/**
 * Type-check the project with its own TypeScript and classify the result. Read-only. Resolves to `{ ok: true, check: 'types', status,
 * statement, counts, files, checked, notes, feature, durationMs }` where `status` is `pass`, `type-errors` (`files` holds the first N errors grouped
 * by file, each `{ line, code, kind, message }`, `kind` being missing-import, unknown-name, type-mismatch or other), `tool-missing` (no TypeScript
 * in the project), `no-config` (no tsconfig.json), `timeout` or `failed`; or to `{ ok: false, error: { code: 'NO_FEATURE', message } }` for a
 * feature that is not on disk. With `feature`, only the errors in that feature's files are reported (the whole program is still checked:
 * `tsc -p` cannot take a file list).
 *
 * @param {string} root Project root.
 * @param {{ feature?: string, timeoutMs?: number, limit?: number }} [opts] `feature` narrows the report; `timeoutMs` bounds tsc; `limit` is how many errors are listed.
 * @returns {Promise<object>} The classified result.
 *
 * @example
 * const r = await runTypesCheck(root, { feature: 'products' });
 * r.status; // => 'type-errors'
 */
export async function runTypesCheck(root, opts = {}) {
  const { feature, timeoutMs = VERIFY_TIMEOUTS.typesMs, limit = VERIFY_LIMITS.errors } = opts;
  let prefix = null;
  if (feature !== undefined) {
    if (typeof feature !== 'string' || !FEATURE_RE.test(feature)) return fail('NO_FEATURE', `"${feature}" is not a feature name: use letters, numbers, "_" and "-" only.`);
    let featuresRoot = 'features';
    try { featuresRoot = (loadConfig(root).features?.root || 'features').split('/').filter(Boolean).join('/'); } catch { /* the default folder */ }
    if (!fs.existsSync(path.join(root, featuresRoot, feature))) return fail('NO_FEATURE', `Feature "${feature}" does not exist in ${featuresRoot}/.`);
    prefix = `${featuresRoot}/${feature}/`;
  }
  const started = Date.now();
  const hadBuildInfo = buildInfoFiles(root);
  const { violations, checked } = runTypeCheckDetailed(root, { severity: 'error', timeoutMs });
  // A read-only check leaves nothing behind: the build-info file an incremental tsconfig makes tsc write is removed unless it was already there.
  for (const file of buildInfoFiles(root)) if (!hadBuildInfo.has(file)) fs.rmSync(file, { force: true });
  const problems = violations.filter((v) => COULD_NOT_RUN.test(v.message)).map((v) => v.message.replace(COULD_NOT_RUN, ''));
  const errors = violations.filter((v) => !COULD_NOT_RUN.test(v.message)).map((v) => {
    const m = TS_MESSAGE.exec(v.message);
    return { file: v.file, line: v.line, code: m?.[1] ?? 'TS0000', message: m?.[2] ?? v.message };
  }).filter((e) => prefix === null || e.file.startsWith(prefix));
  const base = { ok: true, check: 'types', feature: feature ?? null, checked, notes: problems, durationMs: Date.now() - started };
  if (!checked.length && problems.length) {
    const status = couldNotRunStatus(problems[0]);
    return { ...base, status, statement: `The type-check could not run: ${problems[0]}`, counts: { errors: 0, files: 0, shown: 0, omitted: 0, byKind: {} }, files: [] };
  }
  const classified = classifyTypeErrors(errors, { limit });
  return { ...base, ...classified, ...(feature ? { statement: classified.status === 'pass' ? `No type errors in the ${feature} feature.` : `${classified.statement.replace(/\.$/, '')} (in the ${feature} feature).` } : {}) };
}

/**
 * Run the project's `build` script (`npm run build`) through a bounded child process and classify what happened. Read-only from Construct's side (a
 * build writes its own output folder; nothing else is written). The child runs in its own process group with a clean environment, is
 * killed as a group when `timeoutMs` passes, and only the first and last part of its output is kept (`outputCap`). Resolves to
 * `{ ok: true, check: 'build', status, script, statement, errors, excerpt, exitCode, outputTruncated, durationMs }` with `status` one of `pass`,
 * `compile-error` (the first N `{ file, line, message }`), `missing-script` (package.json has no `build` script), `timeout` or `failed` (which also carries
 * `failure`, the `{ kind: 'other', title, message }` object `classifyFailure` of the test runners gives an unclassified failure).
 *
 * @param {string} root Project root.
 * @param {{ timeoutMs?: number, outputCap?: number, limit?: number, command?: { file: string, args: string[] } }} [opts] `timeoutMs` and `outputCap` bound the child;
 *   `limit` is how many errors are listed; `command` replaces `npm run build` (a test seam).
 * @returns {Promise<object>} The classified result.
 *
 * @example
 * (await runBuildCheck(root)).status; // => 'compile-error'
 */
export async function runBuildCheck(root, opts = {}) {
  const { timeoutMs = VERIFY_TIMEOUTS.buildMs, outputCap = VERIFY_LIMITS.output, limit = VERIFY_LIMITS.errors } = opts;
  const script = buildScriptOf(root);
  const base = { ok: true, check: 'build', script, exitCode: null, outputTruncated: false, errors: [], excerpt: '' };
  if (script === null && !opts.command) {
    const has = fs.existsSync(path.join(root, 'package.json'));
    return { ...base, status: 'missing-script', durationMs: 0, statement: has ? 'package.json has no "build" script, so there is nothing to run. Add one (for example "build": "next build" or "vite build").' : 'This project has no package.json, so there is no build script to run.' };
  }
  const started = Date.now();
  const run = await runBounded(root, opts.command ?? { file: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['run', 'build'] }, { timeoutMs, outputCap });
  const classified = classifyBuildOutput({ exitCode: run.code, output: run.output, timedOut: run.timedOut, timeoutMs }, { limit });
  // A failure the patterns do not know keeps the shape the test runners give an unclassified failure (`{ kind: 'other', title, message }`, testRunner.mjs's classifyFailure).
  const failure = classified.status === 'failed' ? { failure: classifyFailure(classified.excerpt) } : {};
  return { ...base, ...classified, ...failure, exitCode: run.code, outputTruncated: run.truncated, durationMs: Date.now() - started };
}

/** Spawn one process in its own group, keep the head and the tail of its output, and stop it when the time is up. -> { code, output, timedOut, truncated } */
function runBounded(cwd, { file, args }, { timeoutMs, outputCap }) {
  return new Promise((resolve) => {
    const env = {};
    for (const key of SAFE_ENV) if (process.env[key] !== undefined) env[key] = process.env[key];
    env.CI = '1';
    env.NEXT_TELEMETRY_DISABLED = '1';
    let child;
    try {
      child = spawn(file, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32' });
    } catch (e) {
      resolve({ code: null, output: String(e?.message ?? e), timedOut: false, truncated: false });
      return;
    }
    const headMax = Math.floor(outputCap / 4);
    const tailMax = outputCap - headMax;
    let head = '';
    let tail = '';
    let total = 0;
    let timedOut = false;
    const take = (d) => {
      const text = String(d);
      total += text.length;
      if (head.length < headMax) {
        const room = headMax - head.length;
        head += text.slice(0, room);
        tail += text.slice(room);
      } else tail += text;
      if (tail.length > tailMax * 2) tail = tail.slice(-tailMax);
    };
    child.stdout.on('data', take);
    child.stderr.on('data', take);
    const stop = () => {
      try { if (process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
    };
    const timer = setTimeout(() => { timedOut = true; stop(); }, timeoutMs);
    const finish = (code) => {
      clearTimeout(timer);
      if (tail.length > tailMax) tail = tail.slice(-tailMax);
      const truncated = total > headMax + tailMax;
      resolve({ code, output: truncated ? `${head}\n[... output cut: ${total - head.length - tail.length} characters ...]\n${tail}` : head + tail, timedOut, truncated });
    };
    child.once('error', (e) => { head += String(e?.message ?? e); finish(null); });
    child.once('close', (code) => finish(code));
  });
}

/**
 * The exit code a check maps to: 0 for a pass, 2 when the check could not run (no TypeScript, no tsconfig, no build script, or not a valid feature), 1 for anything it found.
 *
 * @param {object} result A `runTypesCheck` or `runBuildCheck` result.
 * @returns {0|1|2} The process exit code.
 *
 * @example
 * checkExitCode({ ok: true, status: 'compile-error' }); // => 1
 */
export function checkExitCode(result) {
  if (!result.ok) return 2;
  if (result.status === 'pass') return 0;
  return ['tool-missing', 'no-config', 'missing-script'].includes(result.status) ? 2 : 1;
}

/**
 * A finished check as text for a terminal: the statement, then the errors grouped by file (types) or listed (build), each with its kind.
 *
 * @param {object} result A `runTypesCheck` or `runBuildCheck` result.
 * @returns {string} The summary.
 *
 * @example
 * console.log(renderCheckText(await runTypesCheck(root)));
 */
export function renderCheckText(result) {
  if (!result.ok) return result.error.message;
  const head = result.check === 'types' ? 'Type-check' : 'Build';
  const lines = [`${head}: ${result.status.toUpperCase()}. ${result.statement} (${(result.durationMs / 1000).toFixed(1)} s)`];
  if (result.check === 'types') {
    for (const f of result.files ?? []) {
      lines.push(`  ${f.file} (${f.count})`);
      for (const e of f.errors) lines.push(`    line ${e.line}  ${e.code}  [${e.kind}]  ${e.message}`);
    }
    if (result.counts?.omitted) lines.push(`  ... and ${result.counts.omitted} more not listed`);
  } else {
    for (const e of result.errors ?? []) lines.push(`  ${e.file ? `${e.file}${e.line ? `:${e.line}` : ''}  ` : ''}${e.message}`);
    if (result.excerpt) lines.push(...result.excerpt.split('\n').map((l) => `  | ${l}`));
    if (result.outputTruncated) lines.push('  (its output was cut to the first and last part)');
  }
  for (const n of result.notes ?? []) lines.push(`  note: ${n}`);
  return lines.join('\n');
}
