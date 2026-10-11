// ci2 -- the Import agent's verify stage: `construct validate --profile line` on the import folder, the project's types
// (tsc, errors inside the folder only, through the shared type-check) and the folder's tests. Line Import v2 adds the
// loop's checks (importLoop.mjs): the characterization tests in the app's own runner (runCharTests), the logic-map diff,
// unit coverage, and the path-mapped behaviour check of every moved file (checkBehaviour: core check-change's
// checkChangeForMove, imports normalized, pure exports by fast-check). Each check says in one sentence what it found, or why it
// could not run (`skipped`): a project with no TypeScript installed, or a folder with no tests, is said, never faked.
// Pure reads: nothing here writes to the project.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { classifyTypeErrors } from '@line/construct-core/verify';
import { checkChangeForMove } from '@line/construct-core/check-change';
import { moduleSpecifiers } from '@construct/ast/semantic-diff';
import { runTypesCheck } from '../verifyRunner.mjs';
import { measure, loopChecks } from './importLoop.mjs';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../cli/construct.mjs');
const TIMEOUT = 180_000;

/**
 * The `❌ RULE` errors `construct validate` prints, as {rule, at}.
 * @param {any} out
 * @returns {any}
 */
export function parseValidateErrors(out) {
  const lines = String(out).split('\n');
  const errors = [];
  lines.forEach((l, i) => { const m = l.match(/^❌ (\S+)/); if (m) errors.push({ rule: m[1], at: (lines[i + 1] || '').trim(), sentence: (lines[i + 2] || '').trim() }); });
  return errors;
}

/** `construct validate --profile line` on a folder: its errors, or null when it could not run. */
function runValidate(folderRoot) {
  const r = spawnSync(process.execPath, [CLI, 'validate', '--profile', 'line', '--dir', folderRoot], { encoding: 'utf8', timeout: TIMEOUT });
  return r.error ? { error: String(r.error.message), errors: [] } : { error: null, errors: parseValidateErrors(`${r.stdout}\n${r.stderr}`) };
}
const keyOf = (e) => `${e.rule} ${e.at.replace(/:\d+$/, '')}`;

/**
 * The folder's Line problems before the import, as "RULE file" (the baseline verify compares against).
 * @param {any} projectRoot
 * @param {any} folder
 * @returns {any}
 */
export function lineBaseline(projectRoot, folder) {
  // Before the import the folder has no architecture.yml of its own, so validate may name files from the project root
  // (it found the project's config); after the import they are folder-relative. Keys are kept folder-relative.
  const inFolder = (e) => ({ ...e, at: e.at.startsWith(`${folder}/`) ? e.at.slice(folder.length + 1) : e.at });
  return [...new Set(runValidate(path.join(projectRoot, folder)).errors.map(inFolder).map(keyOf))].sort();
}

/**
 * Validate (profile line) on the folder: it fails on a problem the folder did not have before the import.
 * @param {any} folderRoot
 * @param {any} [baseline]
 * @returns {any}
 */
export function checkValidate(folderRoot, baseline = []) {
  const { error, errors } = runValidate(folderRoot);
  if (error) return { id: 'validate', state: 'skipped', sentence: 'Validate could not run on the folder.', detail: error };
  const old = new Set(baseline);
  const added = errors.filter((e) => !old.has(keyOf(e)));
  const kept = errors.length - added.length;
  const keptNote = kept ? ` ${kept} problem${kept === 1 ? ' was' : 's were'} already there before the import.` : '';
  if (!added.length) return { id: 'validate', state: 'pass', sentence: `Validate (profile line) finds no new problems in the folder.${keptNote}`, ...(errors.length ? { detail: errors.map(keyOf).join('\n') } : {}) };
  return { id: 'validate', state: 'fail', sentence: `Validate (profile line) finds ${added.length} new problem${added.length === 1 ? '' : 's'}; the first: ${added[0].sentence || added[0].rule}`.replace(/([^.?!])$/, '$1.'), detail: added.map(keyOf).join('\n') };
}

/**
 * The project's types, errors inside the folder only. Reuses the shared type-check (packages/engine/verifyRunner.mjs
 * runTypesCheck: the project's own tsc, bounded, read-only) and its classifier (packages/core/verify.mjs
 * classifyTypeErrors) instead of a second tsc runner of its own.
 * @param {any} projectRoot
 * @param {any} folder
 * @returns {Promise<any>}
 */
export async function checkTypes(projectRoot, folder) {
  if (!fs.existsSync(path.join(projectRoot, 'tsconfig.json'))) return { id: 'types', state: 'skipped', sentence: 'Types were not checked: the project has no tsconfig.json.' };
  const r = /** @type {any} */ (await runTypesCheck(projectRoot, { timeoutMs: TIMEOUT, limit: Number.MAX_SAFE_INTEGER }));
  if (r.status === 'tool-missing') return { id: 'types', state: 'skipped', sentence: 'Types were not checked: TypeScript is not installed in the project (run npm install there first).' };
  if (r.status === 'no-config') return { id: 'types', state: 'skipped', sentence: 'Types were not checked: the project has no tsconfig.json.' };
  if (r.status !== 'pass' && r.status !== 'type-errors') return { id: 'types', state: 'skipped', sentence: 'Types could not be checked in time.', detail: String(r.statement ?? '') };
  const inFolder = (r.files ?? []).filter((f) => String(f.file).replace(/\\/g, '/').startsWith(`${folder}/`))
    .flatMap((f) => f.errors.map((e) => ({ file: f.file, line: e.line, code: e.code, message: e.message })));
  if (!inFolder.length) return { id: 'types', state: 'pass', sentence: `The types check out in ${folder}.` };
  const c = classifyTypeErrors(inFolder);
  return { id: 'types', state: 'fail', sentence: `The type checker finds ${inFolder.length} error${inFolder.length === 1 ? '' : 's'} in ${folder}.`, detail: [c.statement, ...c.files.flatMap((f) => f.errors.map((e) => `${f.file}:${e.line} ${e.code} ${e.message}`))].join('\n') };
}

function testFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) testFiles(abs, out);
    else if (/\.(test|spec)\.(m?js|tsx?)$/.test(e.name)) out.push(abs);
  }
  return out;
}

/**
 * Check tests.
 * @param {any} projectRoot
 * @param {any} folder
 * @returns {any}
 */
export function checkTests(projectRoot, folder) {
  const files = testFiles(path.join(projectRoot, folder));
  if (!files.length) return { id: 'tests', state: 'skipped', sentence: `There are no tests in ${folder} yet, so none ran.` };
  const vitest = path.join(projectRoot, 'node_modules', 'vitest', 'vitest.mjs');
  const runnable = fs.existsSync(vitest) ? files : files.filter((f) => /\.m?js$/.test(f));
  if (!runnable.length) return { id: 'tests', state: 'skipped', sentence: `The tests in ${folder} need the project's test runner, which is not installed (run npm install there first).` };
  const args = fs.existsSync(vitest) ? [vitest, 'run', folder] : ['--test', ...runnable];
  const r = spawnSync(process.execPath, args, { cwd: projectRoot, encoding: 'utf8', timeout: TIMEOUT });
  if (r.error) return { id: 'tests', state: 'skipped', sentence: 'The tests could not finish in time.', detail: String(r.error.message) };
  if (r.status === 0) return { id: 'tests', state: 'pass', sentence: `The ${runnable.length} test file${runnable.length === 1 ? '' : 's'} in ${folder} pass.` };
  return { id: 'tests', state: 'fail', sentence: `Some tests in ${folder} fail.`, detail: `${r.stdout}\n${r.stderr}`.slice(-2000) };
}

/**
 * The verify stage on the real project.
 * @param {any} projectRoot
 * @param {any} folder
 * @param {any} [baseline]
 * @returns {Promise<any>}
 */
export async function verifyImport(projectRoot, folder, baseline = []) {
  const checks = [checkValidate(path.join(projectRoot, folder), baseline), await checkTypes(projectRoot, folder), checkTests(projectRoot, folder)];
  return { ok: !checks.some((c) => c.state === 'fail'), checks };
}

// ------------------------------------------------------------------------------------------------- Line Import v2 checks
/**
 * The test runner the app itself uses: jest or vitest when installed in the project, else Node's own (`node --test`).
 * @param {string} projectRoot
 * @returns {'jest'|'vitest'|'node'}
 */
export function testRunnerOf(projectRoot) {
  if (fs.existsSync(path.join(projectRoot, 'node_modules', 'jest', 'bin', 'jest.js'))) return 'jest';
  if (fs.existsSync(path.join(projectRoot, 'node_modules', 'vitest', 'vitest.mjs'))) return 'vitest';
  return 'node';
}

/** One test file in the app's runner: passed, or the reason it failed (the end of its output). */
function runOneTest(projectRoot, runner, file) {
  const args = runner === 'jest' ? [path.join(projectRoot, 'node_modules', 'jest', 'bin', 'jest.js'), '--ci', '--runTestsByPath', file]
    : runner === 'vitest' ? [path.join(projectRoot, 'node_modules', 'vitest', 'vitest.mjs'), 'run', file]
      : ['--test', file];
  // The app's runner gets a clean test context (a node:test parent's NODE_TEST_CONTEXT would make the child report to it).
  const { NODE_TEST_CONTEXT: _ctx, NODE_OPTIONS: _opts, ...env } = process.env;
  const r = spawnSync(process.execPath, args, { cwd: projectRoot, encoding: 'utf8', timeout: TIMEOUT, env: { ...env, CI: '1' } });
  if (r.error) return { ok: false, detail: `the runner did not finish: ${r.error.message}` };
  return r.status === 0 ? { ok: true } : { ok: false, detail: `${r.stdout}\n${r.stderr}`.trim().split('\n').slice(-12).join('\n') };
}

/**
 * Run the characterization tests (CharTest[]) in the app's own runner, one file at a time, so each failure names its test.
 * A test file that is gone counts as failed. No tests at all is `skipped`, said, never faked.
 * @param {string} projectRoot
 * @param {string} folder
 * @param {{file: string, title: string, runner?: string}[]} tests
 * @returns {{state: 'pass'|'fail'|'skipped', passed: number, failed: number, total: number, failures: {file: string, title: string}[], sentence: string, detail?: string}}
 */
export function runCharTests(projectRoot, folder, tests) {
  const list = Array.isArray(tests) ? tests : [];
  if (!list.length) return { state: 'skipped', passed: 0, failed: 0, total: 0, failures: [], sentence: `There are no characterization tests for ${folder} yet, so behaviour is checked by the logic map and the behaviour check only.` };
  const runner = testRunnerOf(projectRoot);
  const failures = [];
  const details = [];
  for (const t of list) {
    if (!fs.existsSync(path.join(projectRoot, t.file))) { failures.push({ file: t.file, title: t.title }); details.push(`${t.file}: the test file is gone`); continue; }
    const r = runOneTest(projectRoot, runner, t.file);
    if (!r.ok) { failures.push({ file: t.file, title: t.title }); details.push(`${t.file}:\n${r.detail}`); }
  }
  const failed = failures.length;
  return {
    state: failed ? 'fail' : 'pass', passed: list.length - failed, failed, total: list.length, failures,
    sentence: failed ? `${failed} of ${list.length} characterization tests fail (${runner}).` : `The ${list.length} characterization test${list.length === 1 ? '' : 's'} pass (${runner}).`,
    ...(details.length ? { detail: details.join('\n').slice(-4000) } : {}),
  };
}

const moduleOf = (p) => String(p).replace(/\.(?:[cm]?[jt]sx?)$/, '');
const CODE_FILE = /\.(?:[cm]?[jt]sx?)$/;
const EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '/index.ts', '/index.tsx', '/index.js'];

/** Every file under a folder (project-relative), without node_modules and dot folders. */
function filesUnder(projectRoot, folder) {
  const out = [];
  const visit = (abs) => {
    for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      const p = path.join(abs, e.name);
      if (e.isDirectory()) visit(p); else out.push(path.relative(projectRoot, p).split(path.sep).join('/'));
    }
  };
  if (fs.existsSync(path.join(projectRoot, folder))) visit(path.join(projectRoot, folder));
  return out;
}

/**
 * Moves of files the logic map cannot see (no units): for each relative import in the baseline sources whose target is
 * gone, the one file in the folder with the same name, as old module -> new module.
 * @param {string} projectRoot
 * @param {string} folder
 * @param {Record<string, string>} sources
 * @param {Record<string, string>} known Moves already known.
 * @returns {Record<string, string>}
 */
function unitlessMoves(projectRoot, folder, sources, known) {
  const out = {};
  let here = null;
  for (const [file, source] of Object.entries(sources ?? {})) {
    for (const s of moduleSpecifiers(source)) {
      if (!s.value.startsWith('.')) continue;
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(file), s.value));
      const key = moduleOf(target);
      if (known[key] || out[key] || EXTS.some((x) => fs.existsSync(path.join(projectRoot, `${target}${x}`)))) continue;
      here ??= filesUnder(projectRoot, folder);
      const base = path.posix.basename(target);
      const hits = here.filter((f) => path.posix.basename(f) === base || moduleOf(path.posix.basename(f)) === base);
      if (hits.length === 1) out[key] = moduleOf(hits[0]);
    }
  }
  return out;
}

/**
 * The path-mapped behaviour check of an import so far: every file of the baseline whose logic moved (old path -> the
 * path most of its units went to) or whose text changed in place, through core check-change's checkChangeForMove, with
 * every move as the specifier map so rewritten imports read as the same modules.
 * @param {string} projectRoot
 * @param {any} diff MapDiff of the baseline against the map now.
 * @param {Record<string, string>} sources The baseline's source per project-relative file.
 * @param {string} [folder] The import folder (where files without logic units are looked for once they moved).
 * @returns {{from: string, to: string, verdict: 'same-behaviour'|'changed'|'cant-tell', detail?: string}[]}
 */
export function checkBehaviour(projectRoot, diff, sources, folder = '') {
  const dest = new Map();
  for (const m of diff?.moved ?? []) {
    const c = dest.get(m.from.file) ?? new Map();
    // An export alone says little (a thin wrapper exports the same name); the logic inside says where the file went.
    c.set(m.to.file, (c.get(m.to.file) ?? 0) + (m.from.kind === 'export' ? 1 : 10));
    dest.set(m.from.file, c);
  }
  const all = folder ? filesUnder(projectRoot, folder).filter((f) => CODE_FILE.test(f)) : [];
  /** Where a file may have gone, best first: most of its logic, then the same name, then the closest size. */
  const candidatesOf = (from, counts) => {
    const size = (f) => { try { return Math.abs(fs.statSync(path.join(projectRoot, f)).size - String(sources[from] ?? '').length); } catch { return Infinity; } };
    const named = all.filter((f) => f !== from && path.posix.basename(f) === path.posix.basename(from));
    return [...new Set([...counts.keys(), ...named])].sort((a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || size(a) - size(b));
  };
  /** @type {Record<string, string>} */
  const moves = {};
  const tried = [];
  for (const [from, counts] of dest) {
    const candidates = candidatesOf(from, counts);
    moves[moduleOf(from)] = moduleOf(candidates[0]);
    tried.push({ from, candidates });
  }
  // Files with no logic units of their own (a JSON fixture, a types file) move too: an import that pointed at a file
  // that is gone now points at the one file of the same name in the folder.
  Object.assign(moves, unitlessMoves(projectRoot, folder, sources, moves));
  for (const file of Object.keys(sources ?? {})) {
    if (dest.has(file) || !fs.existsSync(path.join(projectRoot, file))) continue;
    if (fs.readFileSync(path.join(projectRoot, file), 'utf8') !== sources[file]) tried.push({ from: file, candidates: [file] });
  }
  const one = (from, to) => {
    try {
      const r = checkChangeForMove(projectRoot, from, to, { beforeSource: sources[from], moves });
      const diverged = /** @type {any[]} */ (r.propertyCheck?.checked ?? []).find((c) => c.verdict === 'diverged');
      return { from, to, verdict: r.verdict, ...(diverged ? { detail: `${diverged.name}(${JSON.stringify(diverged.input).slice(1, -1)}) was ${JSON.stringify(diverged.before)}, is ${JSON.stringify(diverged.after)}` } : r.reason ? { detail: r.reason } : {}) };
    } catch (e) {
      return { from, to, verdict: /** @type {const} */ ('cant-tell'), detail: String(/** @type {any} */ (e)?.message ?? e) };
    }
  };
  // The first candidate that behaves the same is where the file went (a thin wrapper beside it is new code, not the move).
  return tried.filter((t) => typeof sources?.[t.from] === 'string').map(({ from, candidates }) => {
    let first = null;
    for (const to of candidates.slice(0, 4)) {
      moves[moduleOf(from)] = moduleOf(to);
      const r = one(from, to);
      first ??= r;
      if (r.verdict === 'same-behaviour') return r;
    }
    moves[moduleOf(from)] = moduleOf(first.to);
    return first;
  });
}

/**
 * The loop's checks on the real project at verify (characterization tests, logic map, behaviour, unit coverage), each one
 * sentence plus typed fixes. `ops` are the import loop's disk ops (importLoopDisk.mjs createLogicOnDisk).
 * @param {string} projectRoot
 * @param {string} folder
 * @param {any} logic The import plan file's logic record.
 * @param {any} ops
 * @returns {Promise<any[]>}
 */
export async function verifyImportLogic(projectRoot, folder, logic, ops) {
  const m = await measure(ops, { root: projectRoot, folder, logic });
  return loopChecks(m, logic, { at: 'verify', folder });
}
