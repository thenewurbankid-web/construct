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

/**
 * Run the project's own TypeScript over its tsconfig and return TYPE-001 violations.
 *
 * @param {string} root Project directory (cwd of the run; reported paths are relative to it).
 * @param {{severity?: string, tsconfig?: string, timeoutMs?: number, files?: string[]}} [options]
 *   `severity` of each type error ('error' | 'warning'); `tsconfig` path relative to root
 *   (default `tsconfig.json`); `timeoutMs` bound for the run; `files` (relative or absolute)
 *   limits reported diagnostics to those files -- the whole program is still checked, since
 *   `tsc -p` cannot take a file list, but only errors in the touched files are reported.
 * @returns {object[]} Violations: one per diagnostic (severity from options), or a single
 *   'TYPE-001 could not run: <reason>' warning.
 * @example
 * runTypeCheck('/work/app', { severity: 'error', files: ['src/App.tsx'] });
 */
export function runTypeCheck(root, options = {}) {
  const { severity = 'error', tsconfig = 'tsconfig.json', timeoutMs = TYPE_CHECK_TIMEOUT_MS, files } = options;
  const tsc = resolveProjectTsc(root);
  if (!tsc) return [couldNotRun(tsconfig, 'TypeScript is not installed in this project (no node_modules/typescript found)')];
  const tsconfigAbs = path.resolve(root, tsconfig);
  if (!fs.existsSync(tsconfigAbs)) return [couldNotRun(tsconfig, `no ${tsconfig} found in the project`)];

  const res = spawnSync(process.execPath, [tsc, '--noEmit', '--pretty', 'false', '-p', tsconfigAbs], {
    cwd: root, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, shell: false,
  });
  if (res.error) {
    const reason = res.error.code === 'ETIMEDOUT' ? `tsc did not finish within ${timeoutMs}ms` : `tsc failed to start (${res.error.message})`;
    return [couldNotRun(tsconfig, reason)];
  }
  const diagnostics = parseTscOutput(res.stdout);
  if (res.status !== 0 && !diagnostics.length) {
    const detail = `${res.stderr || res.stdout || ''}`.trim().split('\n')[0] || `exit code ${res.status}`;
    return [couldNotRun(tsconfig, `tsc exited ${res.status} without diagnostics (${detail})`)];
  }

  const scope = files?.length
    ? new Set(files.map((f) => path.relative(root, path.resolve(root, f)).replace(/\\/g, '/')))
    : null;
  const out = [];
  for (const d of diagnostics) {
    const file = d.file ? path.relative(root, path.resolve(root, d.file)).replace(/\\/g, '/') : tsconfig;
    if (scope && !scope.has(file)) continue;
    out.push(makeViolation({
      rule: 'TYPE-001',
      module: 'architecture',
      severity,
      file,
      line: d.line,
      message: `${d.code}: ${d.text}`,
      why: 'the file does not type-check',
      expected: [],
      suggestedFix: 'fix the type error or the missing import',
    }));
  }
  return out;
}
