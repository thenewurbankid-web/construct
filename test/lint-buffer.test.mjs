import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { walk, rel } from '../packages/core/fs.mjs';
import { FILE_EXTENSIONS, validateArchitecture } from '../packages/core/architecture-enforcer.mjs';
import { lintBuffer } from '../packages/core/lint-buffer.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tmpProject() {
  return makeTempDir('construct-lintbuffer-');
}

// Every fixture here has no `frozen:`, `CLIENT-001`, `TYPE-001` or `exceptions:`
// config -- none of validateArchitecture's project-scope-only checks (frozen index,
// CLIENT-001's whole import graph, TYPE-001's tsc run, expired exceptions) apply, so
// its output over the whole tree is exactly the union of lintBuffer's output over
// each file, one buffer at a time. That's the parity this test checks.
const PARITY_FIXTURES = [
  'architecture-valid',
  'architecture-invalid',
  'architecture-valid-react-spa',
  'architecture-valid-react-spa-multi-route',
  'architecture-valid-singular-layers',
];

function violationKey(v) {
  return JSON.stringify([v.rule, v.file, v.line ?? null, v.message]);
}

function sortedKeys(violations) {
  return violations.map(violationKey).sort();
}

for (const name of PARITY_FIXTURES) {
  test(`lintBuffer parity with construct validate over fixtures/${name}`, () => {
    const dir = path.join(REPO_ROOT, 'fixtures', name);
    const { violations: fullPass } = validateArchitecture(dir);

    const files = walk(dir).filter((p) => FILE_EXTENSIONS.has(path.extname(p)));
    assert.ok(files.length > 0, `expected at least one source file in fixtures/${name}`);

    const perBuffer = [];
    for (const abs of files) {
      const source = fs.readFileSync(abs, 'utf8');
      const { violations } = lintBuffer(dir, rel(dir, abs), source);
      perBuffer.push(...violations);
    }

    assert.deepEqual(sortedKeys(perBuffer), sortedKeys(fullPass));
  });
}

// ---- filesystem-backed behavior specific to lintBuffer (unsaved-content semantics) ----

test('lintBuffer reports a violation for unsaved buffer content, before the file is saved to disk', () => {
  const dir = tmpProject();
  fs.mkdirSync(path.join(dir, 'features', 'x', 'pages'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'rules:\n  PAGE-004: error\n');
  // The file does not exist on disk at all -- an editor's "new, unsaved file" case.
  const file = path.join(dir, 'features', 'x', 'pages', 'X.tsx');
  const source = `export function X(){fetch("/");return <div/>}`;

  const { violations } = lintBuffer(dir, file, source);
  assert.ok(violations.some((v) => v.rule === 'PAGE-004'));

  const onDisk = validateArchitecture(dir);
  assert.equal(onDisk.violations.some((v) => v.rule === 'PAGE-004'), false, 'nothing on disk yet');
});

test('lintBuffer reflects the buffer, not the last-saved content, once the file exists on disk', () => {
  const dir = tmpProject();
  fs.mkdirSync(path.join(dir, 'features', 'x', 'pages'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'rules:\n  PAGE-004: error\n');
  const file = path.join(dir, 'features', 'x', 'pages', 'X.tsx');
  fs.writeFileSync(file, `export function X(){ return <div/>; }`); // saved, clean

  const unsavedSource = `export function X(){fetch("/");return <div/>}`; // dirty buffer
  const { violations } = lintBuffer(dir, file, unsavedSource);
  assert.ok(violations.some((v) => v.rule === 'PAGE-004'));

  const onDisk = validateArchitecture(dir);
  assert.equal(onDisk.violations.some((v) => v.rule === 'PAGE-004'), false, 'saved content is still clean');
});

test('lintBuffer skips a frozen file, same as validateArchitecture', () => {
  const dir = tmpProject();
  fs.mkdirSync(path.join(dir, 'features', 'x', 'pages'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'rules:\n  PAGE-004: error\nfrozen:\n  - "features/x/pages/Frozen.tsx"\n');
  const file = path.join(dir, 'features', 'x', 'pages', 'Frozen.tsx');
  const source = `export function X(){fetch("/");return <div/>}`;

  const { violations } = lintBuffer(dir, file, source);
  assert.equal(violations.length, 0);
});

test('lintBuffer reports SOC-001 for an unclassifiable feature file, same wording as validateArchitecture', () => {
  const dir = tmpProject();
  fs.mkdirSync(path.join(dir, 'features', 'checkout', 'utils'), { recursive: true });
  const file = path.join(dir, 'features', 'checkout', 'utils', 'helpers.ts');
  const source = `export const x = 1;`;
  fs.writeFileSync(file, source);

  const { violations } = lintBuffer(dir, file, source);
  const onDisk = validateArchitecture(dir);

  assert.equal(violations.length, 1);
  assert.equal(violations[0].rule, 'SOC-001');
  assert.deepEqual(sortedKeys(violations), sortedKeys(onDisk.violations));
});
