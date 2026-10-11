// ci2 -- the Import agent's verify stage: `construct validate --profile line` on the import folder, the project's types
// (tsc, errors inside the folder only) and the folder's tests. Each check says in one sentence what it found, or why it
// could not run (`skipped`): a project with no TypeScript installed, or a folder with no tests, is said, never faked.
// Pure reads: nothing here writes to the project.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CLI = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../cli/construct.mjs');
const TIMEOUT = 180_000;

/** The `❌ RULE` errors `construct validate` prints, as {rule, at}. */
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

/** The folder's Line problems before the import, as "RULE file" (the baseline verify compares against). */
export function lineBaseline(projectRoot, folder) {
  return [...new Set(runValidate(path.join(projectRoot, folder)).errors.map(keyOf))].sort();
}

/** Validate (profile line) on the folder: it fails on a problem the folder did not have before the import. */
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

export function checkTypes(projectRoot, folder) {
  if (!fs.existsSync(path.join(projectRoot, 'tsconfig.json'))) return { id: 'types', state: 'skipped', sentence: 'Types were not checked: the project has no tsconfig.json.' };
  const tsc = path.join(projectRoot, 'node_modules', 'typescript', 'bin', 'tsc');
  if (!fs.existsSync(tsc)) return { id: 'types', state: 'skipped', sentence: 'Types were not checked: TypeScript is not installed in the project (run npm install there first).' };
  const r = spawnSync(process.execPath, [tsc, '--noEmit', '-p', projectRoot], { cwd: projectRoot, encoding: 'utf8', timeout: TIMEOUT });
  if (r.error) return { id: 'types', state: 'skipped', sentence: 'Types could not be checked in time.', detail: String(r.error.message) };
  const inFolder = String(r.stdout).split('\n').filter((l) => /error TS\d+/.test(l) && l.replace(/\\/g, '/').startsWith(`${folder}/`));
  if (!inFolder.length) return { id: 'types', state: 'pass', sentence: `The types check out in ${folder}.` };
  return { id: 'types', state: 'fail', sentence: `The type checker finds ${inFolder.length} error${inFolder.length === 1 ? '' : 's'} in ${folder}.`, detail: inFolder.slice(0, 20).join('\n') };
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

/** The verify stage on the real project. */
export async function verifyImport(projectRoot, folder, baseline = []) {
  const checks = [checkValidate(path.join(projectRoot, folder), baseline), checkTypes(projectRoot, folder), checkTests(projectRoot, folder)];
  return { ok: !checks.some((c) => c.state === 'fail'), checks };
}
