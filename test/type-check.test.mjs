// #495 -- TYPE-001: opt-in real TypeScript type-check in `construct validate`.
// The fixtures resolve the repo's own node_modules/typescript by walking up from the project dir
// (the same resolution a real project gets from its own node_modules).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT_CODES } from '../packages/core/diagnostics.mjs';
import { validateArchitecture } from '../packages/core/architecture-enforcer.mjs';
import { parseTscOutput, runTypeCheck, runTypeCheckDetailed, solutionReferences, resolveProjectTsc } from '../packages/core/type-check.mjs';
import { DEFAULT_RULES } from '../packages/core/config.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const bin = path.join(repoRoot, 'packages', 'cli', 'construct.mjs');
const fixture = (name) => path.join(repoRoot, 'fixtures', name);

function validateCli(dir) {
  const res = spawnSync(process.execPath, [bin, 'validate', '--dir', dir, '--format', 'json'], { encoding: 'utf8', cwd: repoRoot });
  return { status: res.status, report: JSON.parse(res.stdout) };
}

test('TYPE-001 is registered in DEFAULT_RULES and off by default', () => {
  assert.equal(DEFAULT_RULES['TYPE-001'].severity, 'off');
  assert.ok(DEFAULT_RULES['TYPE-001'].name);
});

test('TYPE-001 off (default): a project with a real type error passes, tsc never runs', () => {
  const { status, report } = validateCli(fixture('type-check-off-failing'));
  assert.equal(status, EXIT_CODES.OK);
  assert.equal(report.status, 'passed');
  assert.equal(report.violations.some((v) => v.rule === 'TYPE-001'), false);
});

test('TYPE-001 on and failing: TS2304 reported with file and line, exit 1, JSON shape like other rules', () => {
  const { status, report } = validateCli(fixture('type-check-failing'));
  assert.equal(status, EXIT_CODES.VIOLATIONS);
  assert.equal(report.status, 'failed');
  const useRef = report.violations.find((v) => v.rule === 'TYPE-001' && /TS2304: Cannot find name 'useRef'/.test(v.message));
  assert.ok(useRef, 'the useRef diagnostic must be reported');
  assert.equal(useRef.file, 'src/useCanvasEditor.ts');
  assert.equal(useRef.line, 3);
  assert.equal(useRef.severity, 'error');
  assert.equal(useRef.module, 'architecture');
  assert.equal(useRef.why, 'the file does not type-check');
  assert.equal(useRef.suggestedFix, 'fix the type error or the missing import');
  assert.ok(report.violations.some((v) => /Cannot find name 'useState'/.test(v.message)));
});

test('TYPE-001 on and clean: exit 0', () => {
  const { status, report } = validateCli(fixture('type-check-clean'));
  assert.equal(status, EXIT_CODES.OK);
  assert.equal(report.status, 'passed');
  assert.deepEqual(report.violations, []);
});

test('TYPE-001 scoped to files: only diagnostics in the touched files are reported', () => {
  const dir = fixture('type-check-failing');
  const scoped = validateArchitecture(dir, { files: ['src/useCanvasEditor.ts'] }).violations.filter((v) => v.rule === 'TYPE-001');
  assert.equal(scoped.length, 2);
  const elsewhere = validateArchitecture(dir, { files: ['src/other.ts'] }).violations.filter((v) => v.rule === 'TYPE-001');
  assert.deepEqual(elsewhere, []);
});

test('TYPE-001 with TypeScript missing: a distinct "could not run" warning, not a crash and not a failure', () => {
  const dir = makeTempDir('construct-type-check-');
  fs.cpSync(fixture('type-check-failing'), dir, { recursive: true });
  const { status, report } = validateCli(dir);
  assert.equal(status, EXIT_CODES.OK, 'a warning does not fail the run');
  const w = report.violations.find((v) => v.rule === 'TYPE-001');
  assert.ok(w, 'must not silently pass');
  assert.equal(w.severity, 'warning');
  assert.match(w.message, /^TYPE-001 could not run: TypeScript is not installed/);
});

test('TYPE-001 with no tsconfig: a "could not run" warning naming the missing file', () => {
  const dir = makeTempDir('construct-type-check-');
  fs.cpSync(fixture('type-check-failing'), dir, { recursive: true });
  fs.rmSync(path.join(dir, 'tsconfig.json'));
  // Provide a TypeScript so the tsconfig is the only thing missing.
  const nm = path.join(dir, 'node_modules');
  fs.mkdirSync(nm);
  fs.symlinkSync(path.join(repoRoot, 'node_modules', 'typescript'), path.join(nm, 'typescript'), 'dir');
  const [w] = runTypeCheck(dir, { severity: 'error' });
  assert.equal(w.severity, 'warning');
  assert.match(w.message, /^TYPE-001 could not run: no tsconfig\.json found/);
});

test('parseTscOutput folds continuation lines and reads global diagnostics', () => {
  const out = [
    "src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.",
    "  Types of property 'x' are incompatible.",
    "error TS18003: No inputs were found in config file.",
  ].join('\n');
  const d = parseTscOutput(out);
  assert.equal(d.length, 2);
  assert.deepEqual([d[0].file, d[0].line, d[0].code], ['src/a.ts', 3, 'TS2322']);
  assert.match(d[0].text, /incompatible\.$/);
  assert.deepEqual([d[1].file, d[1].code], [null, 'TS18003']);
});

// #579 -- a solution-style root tsconfig (references, no files/include) checks its referenced projects.
test('TYPE-001 solution-style with a real error in a referenced project: exit 1, file and line, checked configs named', () => {
  const { status, report } = validateCli(fixture('type-check-solution-failing'));
  assert.equal(status, EXIT_CODES.VIOLATIONS);
  const useRef = report.violations.find((v) => v.rule === 'TYPE-001' && /TS2304: Cannot find name 'useRef'/.test(v.message));
  assert.ok(useRef, 'the useRef diagnostic must be reported through the reference');
  assert.equal(useRef.file, 'src/useCanvasEditor.ts');
  assert.equal(useRef.line, 3);
  assert.equal(useRef.severity, 'error');
  assert.match(useRef.why, /checked via tsconfig\.app\.json/);
  const { checked } = runTypeCheckDetailed(fixture('type-check-solution-failing'), { severity: 'error' });
  assert.deepEqual(checked, ['tsconfig.app.json', 'tools/tsconfig.json']);
});

test('TYPE-001 solution-style and clean: exit 0, both referenced configs (file and directory form) reported as checked', () => {
  const { status, report } = validateCli(fixture('type-check-solution-clean'));
  assert.equal(status, EXIT_CODES.OK);
  assert.equal(report.status, 'passed');
  assert.deepEqual(report.violations, []);
  const { violations, checked } = runTypeCheckDetailed(fixture('type-check-solution-clean'), { severity: 'error' });
  assert.deepEqual(violations, []);
  assert.deepEqual(checked, ['tsconfig.app.json', 'tools/tsconfig.json']);
  assert.deepEqual(validateArchitecture(fixture('type-check-solution-clean')).typeCheck, { checked });
});

test('TYPE-001 solution-style whose referenced project has zero files: a "checked zero files" warning, not a pass', () => {
  const { status, report } = validateCli(fixture('type-check-solution-empty'));
  assert.equal(status, EXIT_CODES.OK, 'a warning does not fail the run');
  const w = report.violations.find((v) => v.rule === 'TYPE-001');
  assert.ok(w, 'must not silently pass');
  assert.equal(w.severity, 'warning');
  assert.match(w.message, /^TYPE-001 could not run: checked zero files: tsconfig\.app\.json/);
  assert.deepEqual(runTypeCheckDetailed(fixture('type-check-solution-empty')).checked, []);
});

test('TYPE-001 zero files also applies to a plain (non-solution) tsconfig', () => {
  const [w] = runTypeCheck(fixture('type-check-solution-empty'), { severity: 'error', tsconfig: 'tsconfig.app.json' });
  assert.equal(w.severity, 'warning');
  assert.match(w.message, /^TYPE-001 could not run: checked zero files: tsconfig\.app\.json/);
});

test('TYPE-001 solution-style with a reference that cannot be found: a warning naming it, the other reference is still checked', () => {
  const { violations, checked } = runTypeCheckDetailed(fixture('type-check-solution-missing-ref'), { severity: 'error' });
  assert.equal(violations.length, 1);
  assert.equal(violations[0].severity, 'warning');
  assert.match(violations[0].message, /^TYPE-001 could not run: referenced project tsconfig\.node\.json .*not found/);
  assert.deepEqual(checked, ['tsconfig.app.json']);
});

test('solutionReferences: a normal tsconfig (with include) is not solution-style; a solution config lists its references', () => {
  const dir = fixture('type-check-clean');
  const tsc = resolveProjectTsc(dir);
  assert.equal(solutionReferences(tsc, dir, path.join(dir, 'tsconfig.json')), null);
  const sol = fixture('type-check-solution-clean');
  const refs = solutionReferences(tsc, sol, path.join(sol, 'tsconfig.json')).map((p) => path.relative(sol, p));
  assert.deepEqual(refs, ['tsconfig.app.json', 'tools']);
});
