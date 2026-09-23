// #495 -- TYPE-001: a real TypeScript type-check as an opt-in `construct validate` rule.
//
// Why: an `--llm` fill can produce code that parses and matches its layer's shape but does not
// compile (`Cannot find name 'useRef'`), and neither the rule engine nor a transpile-only
// `vite build` notices. This runs the TARGET PROJECT'S OWN TypeScript (resolved from its
// node_modules, walking up for monorepos; never a global tsc) as `node <tsc.js> --noEmit -p
// <tsconfig> --pretty false` via an argv-array spawn (no shell), with a bounded timeout, and maps
// each diagnostic to a violation. If it cannot run (no TypeScript, no tsconfig, spawn failure,
// timeout, unparseable output) it reports a distinct 'TYPE-001 could not run: <reason>' warning,
// never a silent pass and never a crash.
//
// #579 -- a Vite/React template's root tsconfig.json is solution-style (`references`, no `files` /
// `include`), so `tsc --noEmit -p` on it checks nothing. When the chosen config is solution-style
// this checks each `references[].path` project instead (one `tsc --noEmit -p` per project -- never
// `tsc -b`, which emits), merges the diagnostics, and reports which configs were actually checked.
// A config that resolves to zero files is a 'could not run: checked zero files' warning, never a pass.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeViolation } from './diagnostics.mjs';

/** Default upper bound for one type-check run. */
export const TYPE_CHECK_TIMEOUT_MS = 120_000;

// `path(line,col): error TS2304: message` (tsc --pretty false); continuation lines are indented.
const DIAGNOSTIC_LINE = /^(.+?)\((\d+),(\d+)\): (error|warning) (TS\d+): (.*)$/;
const GLOBAL_DIAGNOSTIC_LINE = /^(error|warning) (TS\d+): (.*)$/;

/**
 * Find `typescript/lib/tsc.js` starting from `root` and walking up parent directories.
 *
 * @param {string} root Project directory.
 * @returns {string|null} Absolute path to the project's own tsc entry point, or null.
 */
export function resolveProjectTsc(root) {
  let dir = path.resolve(root);
  for (;;) {
    const candidate = path.join(dir, 'node_modules', 'typescript', 'lib', 'tsc.js');
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Parse `tsc --pretty false` output into diagnostics. Multi-line messages are folded into one.
 *
 * @param {string} output Combined stdout of a tsc run.
 * @returns {{file: string|null, line: number, code: string, severity: string, text: string}[]} Parsed diagnostics, in output order.
 */
export function parseTscOutput(output) {
  const diagnostics = [];
  let last = null;
  for (const raw of String(output).split(/\r?\n/)) {
    const m = DIAGNOSTIC_LINE.exec(raw);
    if (m) {
      last = { file: m[1].replace(/\\/g, '/'), line: Number(m[2]), code: m[5], severity: m[4], text: m[6] };
      diagnostics.push(last);
      continue;
    }
    const g = GLOBAL_DIAGNOSTIC_LINE.exec(raw);
    if (g) {
      last = { file: null, line: 1, code: g[2], severity: g[1], text: g[3] };
      diagnostics.push(last);
      continue;
    }
    if (last && /^\s+\S/.test(raw)) last.text += ` ${raw.trim()}`;
    else last = null;
  }
  return diagnostics;
}

const couldNotRun = (tsconfig, reason) => makeViolation({
  rule: 'TYPE-001',
  module: 'architecture',
  severity: 'warning',
  file: tsconfig,
  line: 1,
  message: `TYPE-001 could not run: ${reason}`,
  why: 'TYPE-001 is enabled but the type-check could not be performed, so the project was not checked (this is not a pass).',
  expected: [],
  suggestedFix: 'Install TypeScript in the project (npm i -D typescript) and provide a tsconfig.json, or set `rules: { TYPE-001: { severity: error, tsconfig: <path> } }` in architecture.yml.',
});

/** Run tsc with an argv array (no shell), from `root`, bounded by `timeoutMs`. */
const spawnTsc = (tsc, root, args, timeoutMs) => spawnSync(process.execPath, [tsc, ...args], {
  cwd: root, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, shell: false,
});

const spawnFailure = (res, timeoutMs) => (res.error.code === 'ETIMEDOUT'
  ? `tsc did not finish within ${timeoutMs}ms`
  : `tsc failed to start (${res.error.message})`);

/**
 * Decide whether a tsconfig is solution-style (`references` and no `files`/`include`, after
 * `extends` is resolved) and list its referenced project paths, via `tsc --showConfig` so JSONC
 * comments, trailing commas and `extends` are handled by TypeScript itself.
 *
 * @param {string} tsc Absolute path to the project's tsc.js.
 * @param {string} root Project directory (spawn cwd).
 * @param {string} tsconfigAbs Absolute path of the tsconfig to inspect.
 * @param {number} [timeoutMs] Bound for the spawn.
 * @returns {string[]|null} Absolute `references[].path` values (directories not yet resolved)
 *   when solution-style, or null for a normal config (or one whose config cannot be shown).
 */
export function solutionReferences(tsc, root, tsconfigAbs, timeoutMs = TYPE_CHECK_TIMEOUT_MS) {
  const res = spawnTsc(tsc, root, ['--showConfig', '-p', tsconfigAbs], timeoutMs);
  if (res.error || res.status !== 0) return null;
  let config;
  try { config = JSON.parse(res.stdout); } catch { return null; }
  const refs = Array.isArray(config.references) ? config.references : [];
  const hasInputs = (Array.isArray(config.files) && config.files.length > 0) || config.include !== undefined;
  if (!refs.length || hasInputs) return null;
  return refs.filter((r) => r && typeof r.path === 'string').map((r) => path.resolve(path.dirname(tsconfigAbs), r.path));
}

/**
 * Resolve one `references[].path` to a tsconfig file the way tsc does: a directory means its
 * `tsconfig.json`; a file is used as is (a missing `.json` extension is tolerated).
 *
 * @param {string} refPath Absolute path from a `references` entry.
 * @returns {string|null} Absolute tsconfig path, or null when nothing exists there.
 */
export function resolveReference(refPath) {
  const isFile = (p) => fs.existsSync(p) && fs.statSync(p).isFile();
  if (fs.existsSync(refPath) && fs.statSync(refPath).isDirectory()) {
    const inDir = path.join(refPath, 'tsconfig.json');
    return isFile(inDir) ? inDir : null;
  }
  if (isFile(refPath)) return refPath;
  return isFile(`${refPath}.json`) ? `${refPath}.json` : null;
}

/**
 * Count the project's own source files a tsconfig resolves to (`tsc --listFilesOnly`), ignoring
 * TypeScript's bundled `lib.*.d.ts` and anything under `node_modules`.
 *
 * @returns {{count: number}|{error: string}} The count, or why it could not be counted.
 */
function countProjectFiles(tsc, root, tsconfigAbs, timeoutMs) {
  const res = spawnTsc(tsc, root, ['--listFilesOnly', '-p', tsconfigAbs], timeoutMs);
  if (res.error) return { error: spawnFailure(res, timeoutMs) };
  const libDir = path.dirname(tsc);
  const listed = String(res.stdout).split(/\r?\n/).map((l) => l.trim()).filter((l) => path.isAbsolute(l));
  const own = listed.filter((f) => !f.startsWith(libDir + path.sep) && !f.split(/[\\/]/).includes('node_modules'));
  return { count: own.length };
}

/**
 * Type-check one tsconfig: `tsc --noEmit -p`, plus a zero-file guard.
 *
 * @returns {{diagnostics: object[]}|{problem: string, whole?: boolean}} Parsed diagnostics, or a reason it
 *   could not run (`whole`: the reason already names the config).
 */
function checkConfig(tsc, root, tsconfigAbs, timeoutMs, label) {
  const res = spawnTsc(tsc, root, ['--noEmit', '--pretty', 'false', '-p', tsconfigAbs], timeoutMs);
  if (res.error) return { problem: spawnFailure(res, timeoutMs) };
  const diagnostics = parseTscOutput(res.stdout);
  // A diagnostic located in a file proves files were checked. Otherwise (a clean run, or TS18003
  // "no inputs") count the files: a pass over zero files is not a pass.
  if (!diagnostics.some((d) => d.file)) {
    const counted = countProjectFiles(tsc, root, tsconfigAbs, timeoutMs);
    if (counted.error) return { problem: counted.error };
    if (counted.count === 0) return { problem: `checked zero files: ${label}'s include/files match no source files, so nothing was type-checked`, whole: true };
  }
  if (res.status !== 0 && !diagnostics.length) {
    const detail = `${res.stderr || res.stdout || ''}`.trim().split('\n')[0] || `exit code ${res.status}`;
    return { problem: `tsc exited ${res.status} without diagnostics (${detail})` };
  }
  return { diagnostics };
}

/**
 * Run the project's own TypeScript over its tsconfig and return TYPE-001 violations plus the
 * configs that were actually checked. A solution-style tsconfig (`references`, no `files`/
 * `include`) is expanded: each referenced project is checked with `tsc --noEmit -p` (never
 * `tsc -b`, which emits) and the diagnostics are merged.
 *
 * @param {string} root Project directory (cwd of the run; reported paths are relative to it).
 * @param {{severity?: string, tsconfig?: string, timeoutMs?: number, files?: string[]}} [options]
 *   `severity` of each type error ('error' | 'warning'); `tsconfig` path relative to root
 *   (default `tsconfig.json`); `timeoutMs` bound for the run; `files` (relative or absolute)
 *   limits reported diagnostics to those files -- the whole program is still checked, since
 *   `tsc -p` cannot take a file list, but only errors in the touched files are reported.
 * @returns {{violations: object[], checked: string[]}} `violations`: one per diagnostic (severity
 *   from options) and/or 'TYPE-001 could not run: <reason>' warnings (unfindable reference, zero
 *   files, no TypeScript, ...); `checked`: root-relative paths of the tsconfigs that were really
 *   checked (empty when nothing could run).
 * @example
 * const { violations, checked } = runTypeCheckDetailed('/work/app', { severity: 'error' });
 * // checked -> ['tsconfig.app.json', 'tsconfig.node.json'] for a Vite solution-style root
 */
export function runTypeCheckDetailed(root, options = {}) {
  const { severity = 'error', tsconfig = 'tsconfig.json', timeoutMs = TYPE_CHECK_TIMEOUT_MS, files } = options;
  const tsc = resolveProjectTsc(root);
  if (!tsc) return { violations: [couldNotRun(tsconfig, 'TypeScript is not installed in this project (no node_modules/typescript found)')], checked: [] };
  const tsconfigAbs = path.resolve(root, tsconfig);
  if (!fs.existsSync(tsconfigAbs)) return { violations: [couldNotRun(tsconfig, `no ${tsconfig} found in the project`)], checked: [] };

  const relToRoot = (p) => path.relative(root, p).replace(/\\/g, '/');
  const scope = files?.length ? new Set(files.map((f) => relToRoot(path.resolve(root, f)))) : null;
  const violations = [];
  const checked = [];

  // Expand solution-style configs depth-first, each config at most once.
  const seen = new Set();
  const targets = [];
  const expand = (abs, viaReference) => {
    if (seen.has(abs)) return;
    seen.add(abs);
    const refs = solutionReferences(tsc, root, abs, timeoutMs);
    if (!refs) { targets.push({ abs, viaReference }); return; }
    for (const ref of refs) {
      const resolved = resolveReference(ref);
      if (!resolved) {
        violations.push(couldNotRun(relToRoot(abs), `referenced project ${relToRoot(ref)} (from ${relToRoot(abs)} "references") was not found: no tsconfig there`));
        continue;
      }
      expand(resolved, true);
    }
  };
  expand(tsconfigAbs, false);

  for (const target of targets) {
    const rel = relToRoot(target.abs);
    const result = checkConfig(tsc, root, target.abs, timeoutMs, rel);
    if (result.problem) { violations.push(couldNotRun(rel, result.whole ? result.problem : `${rel}: ${result.problem}`)); continue; }
    checked.push(rel);
    for (const d of result.diagnostics) {
      const file = d.file ? relToRoot(path.resolve(root, d.file)) : rel;
      if (scope && !scope.has(file)) continue;
      violations.push(makeViolation({
        rule: 'TYPE-001',
        module: 'architecture',
        severity,
        file,
        line: d.line,
        message: `${d.code}: ${d.text}`,
        why: target.viaReference ? `the file does not type-check (checked via ${rel})` : 'the file does not type-check',
        expected: [],
        suggestedFix: 'fix the type error or the missing import',
      }));
    }
  }
  return { violations, checked };
}

/**
 * Run the project's own TypeScript over its tsconfig and return TYPE-001 violations.
 * See {@link runTypeCheckDetailed} for the solution-style (`references`) expansion and for the
 * list of configs that were actually checked.
 *
 * @param {string} root Project directory (cwd of the run; reported paths are relative to it).
 * @param {{severity?: string, tsconfig?: string, timeoutMs?: number, files?: string[]}} [options] Same as {@link runTypeCheckDetailed}.
 * @returns {object[]} Violations: one per diagnostic (severity from options), or
 *   'TYPE-001 could not run: <reason>' warnings.
 * @example
 * runTypeCheck('/work/app', { severity: 'error', files: ['src/App.tsx'] });
 */
export function runTypeCheck(root, options = {}) {
  return runTypeCheckDetailed(root, options).violations;
}
