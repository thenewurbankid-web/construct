import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTransaction } from '../packages/engine/transactionalWriter.mjs';
import { validateArchitecture } from '../packages/core/architecture-enforcer.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

function tmpProject() {
  const dir = makeTempDir('construct-txn-test-');
  fs.mkdirSync(path.join(dir, 'features', 'checkout', 'domain'), { recursive: true });
  return dir;
}

test('createTransaction: writeFile/readFile/pendingFiles operate purely in memory before commit', () => {
  const dir = tmpProject();
  const txn = createTransaction(dir);
  assert.equal(txn.readFile('features/checkout/domain/Total.ts'), undefined);

  txn.writeFile('features/checkout/domain/Total.ts', `export function Total(){ return true; }\n`);
  assert.equal(txn.readFile('features/checkout/domain/Total.ts'), `export function Total(){ return true; }\n`);
  assert.deepEqual(txn.pendingFiles(), ['features/checkout/domain/Total.ts']);

  // Nothing touches disk until commit().
  assert.equal(fs.existsSync(path.join(dir, 'features', 'checkout', 'domain', 'Total.ts')), false);
});

test('commit() writes every staged file to disk when validation passes', () => {
  const dir = tmpProject();
  const txn = createTransaction(dir);
  const target = path.join(dir, 'features', 'checkout', 'domain', 'Total.ts');
  txn.writeFile('features/checkout/domain/Total.ts', `export function Total(){ return true; }\n`);

  const result = txn.commit({ validate: validateArchitecture });

  assert.equal(result.committed, true);
  assert.deepEqual(result.violations.filter((v) => v.severity === 'error'), []);
  assert.equal(fs.existsSync(target), true);
  assert.equal(fs.readFileSync(target, 'utf8'), `export function Total(){ return true; }\n`);
  assert.deepEqual(txn.pendingFiles(), []); // buffer cleared after commit
});

// The core transactional guarantee (Ticket 7.1's acceptance criterion): if
// any staged file fails construct validate, NOTHING under the real project
// root is written -- not even the files that would have individually
// passed.
test('commit() leaves disk completely untouched when the buffered result fails validation (no partial writes)', () => {
  const dir = tmpProject();
  const txn = createTransaction(dir);
  const goodFile = 'features/checkout/domain/Total.ts';
  const badFile = 'features/checkout/pages/CheckoutPage.tsx';
  txn.writeFile(goodFile, `export function Total(){ return true; }\n`);
  // A page calling fetch() directly is a PAGE-004 error-severity violation.
  txn.writeFile(badFile, `export function CheckoutPage(){ fetch('/api'); return null; }\n`);

  const result = txn.commit({ validate: validateArchitecture });

  assert.equal(result.committed, false);
  assert.ok(result.violations.some((v) => v.rule === 'PAGE-004'));
  assert.equal(fs.existsSync(path.join(dir, goodFile)), false, 'the otherwise-clean file must not have been written either');
  assert.equal(fs.existsSync(path.join(dir, badFile)), false);
  // The buffer is preserved (not silently cleared) after an aborted commit,
  // so a caller can inspect/retry.
  assert.deepEqual(txn.pendingFiles().sort(), [badFile, goodFile].sort());
});

// #546 -- commit()'s default used to be validateArchitecture alone, so a step that violated a
// non-architecture rule (SOC, readability, public-api-drift) would commit anyway. The default is
// now the same aggregateValidation(DEFAULT_ENFORCERS) set `construct validate` runs.
test('commit() with no validate option refuses a readability-only violation, not just an architecture one (#546)', () => {
  const dir = tmpProject();
  const txn = createTransaction(dir);
  // A component file whose name doesn't match its export: READ-001, not an architecture rule --
  // validateArchitecture alone (the old default) would have let this commit.
  txn.writeFile('features/checkout/components/CheckoutBadge.tsx', `export function Badge(){ return null; }\n`);

  const result = txn.commit();

  assert.equal(result.committed, false);
  assert.ok(result.violations.some((v) => v.rule === 'READ-001'));
  assert.equal(fs.existsSync(path.join(dir, 'features', 'checkout', 'components', 'CheckoutBadge.tsx')), false);
});

test('commit() with an empty transaction is a no-op success and never touches disk', () => {
  const dir = tmpProject();
  const txn = createTransaction(dir);
  const before = fs.readdirSync(path.join(dir, 'features', 'checkout', 'domain'));
  const result = txn.commit({ validate: validateArchitecture });
  assert.deepEqual(result, { committed: true, violations: [], blastRadius: { files: [], features: [], impact: null } });
  assert.deepEqual(fs.readdirSync(path.join(dir, 'features', 'checkout', 'domain')), before);
});

test('commit() cleans up its shadow temp directory whether it commits or aborts', () => {
  // #882: assert on the exact shadow dirs THIS test's commits created (the validator sees each one), not on a
  // before/after glob of os.tmpdir(): under the full suite other test files run in parallel and create and remove
  // their own construct-txn-* dirs between the two readdir calls.
  const dir = tmpProject();
  const shadows = [];
  const recording = (shadow, opts) => { shadows.push(shadow); return validateArchitecture(shadow, opts); };

  const ok = createTransaction(dir);
  ok.writeFile('features/checkout/domain/Total.ts', `export function Total(){ return true; }\n`);
  assert.equal(ok.commit({ validate: recording }).committed, true);

  const bad = createTransaction(dir);
  bad.writeFile('features/checkout/pages/Bad.tsx', `export function Bad(){ fetch('/'); return null; }\n`);
  assert.equal(bad.commit({ validate: recording }).committed, false);

  assert.equal(shadows.length, 2);
  for (const shadow of shadows) {
    assert.ok(path.basename(shadow).startsWith(`construct-txn-${process.pid}-`), shadow);
    assert.equal(fs.existsSync(shadow), false, `shadow dir ${shadow} should be removed`);
  }
});

test('deleteFile() stages a delete: the shadow copy validates without the file, and disk loses it only when commit passes', () => {
  const dir = tmpProject();
  const rel = 'features/checkout/domain/Old.ts';
  fs.writeFileSync(path.join(dir, rel), 'export const Old = 1;\n');
  const seen = [];
  const keep = createTransaction(dir);
  keep.deleteFile(rel);
  assert.equal(keep.readFile(rel), undefined);
  assert.deepEqual(keep.pendingFiles(), [rel]);
  const refused = keep.commit({ validate: (shadow) => { seen.push(fs.existsSync(path.join(shadow, rel))); return { ok: false, violations: [] }; } });
  assert.equal(refused.committed, false);
  assert.deepEqual(seen, [false], 'the shadow copy no longer has the file');
  assert.equal(fs.existsSync(path.join(dir, rel)), true, 'a refused delete leaves the file in place');

  const txn = createTransaction(dir);
  txn.deleteFile(rel);
  txn.writeFile('features/checkout/domain/New.ts', 'export const New = 1;\n');
  assert.equal(txn.commit({ validate: () => ({ ok: true, violations: [] }) }).committed, true);
  assert.equal(fs.existsSync(path.join(dir, rel)), false);
  assert.equal(fs.existsSync(path.join(dir, 'features/checkout/domain/New.ts')), true);
});

// cm1: the disk refusing a file while the commit lands (permissions, a full disk, a read-only mount) must not leave
// half a change behind: the files already written or deleted are put back, and the disk's own error is thrown.
const canChmod = typeof process.getuid !== 'function' || process.getuid() !== 0;
test('commit() puts back every file it already landed when the disk refuses a later one, then throws the disk error', { skip: canChmod ? false : 'running as root, where a read-only folder can still be written' }, () => {
  const dir = tmpProject();
  const locked = path.join(dir, 'features', 'checkout', 'locked');
  fs.mkdirSync(locked);
  fs.writeFileSync(path.join(dir, 'features/checkout/domain/A.ts'), 'export const A = 1;\n');
  fs.writeFileSync(path.join(dir, 'features/checkout/domain/C.ts'), 'export const C = 1;\n');
  const txn = createTransaction(dir);
  txn.writeFile('features/checkout/domain/A.ts', 'export const A = 2;\n'); // lands first
  txn.deleteFile('features/checkout/domain/C.ts'); // lands second
  txn.writeFile('features/checkout/locked/B.ts', 'export const B = 1;\n'); // the disk refuses this one
  try {
    assert.throws(
      () => txn.commit({ validate: () => { fs.chmodSync(locked, 0o555); return { ok: true, violations: [] }; } }),
      (e) => /** @type {any} */ (e).code === 'EACCES',
    );
  } finally {
    fs.chmodSync(locked, 0o755);
  }
  assert.equal(fs.readFileSync(path.join(dir, 'features/checkout/domain/A.ts'), 'utf8'), 'export const A = 1;\n', 'the edited file is back as it was');
  assert.equal(fs.readFileSync(path.join(dir, 'features/checkout/domain/C.ts'), 'utf8'), 'export const C = 1;\n', 'the deleted file is back');
  assert.equal(fs.existsSync(path.join(locked, 'B.ts')), false);
  assert.deepEqual(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(`construct-txn-${process.pid}-`)), [], 'the shadow copy is gone');
});

test('commit() never lets a shadow-copy cleanup failure replace its result: a read-only folder in the project still commits', { skip: canChmod ? false : 'running as root' }, () => {
  const dir = tmpProject();
  const ro = path.join(dir, 'features', 'checkout', 'frozen-dir');
  fs.mkdirSync(ro);
  fs.writeFileSync(path.join(ro, 'Old.ts'), 'export const Old = 1;\n');
  fs.chmodSync(ro, 0o555); // copied read-only into the shadow, which then cannot be removed as is
  try {
    const txn = createTransaction(dir);
    txn.writeFile('features/checkout/domain/New.ts', 'export const New = 1;\n');
    assert.equal(txn.commit({ validate: () => ({ ok: true, violations: [] }) }).committed, true);
  } finally {
    fs.chmodSync(ro, 0o755);
  }
  assert.equal(fs.existsSync(path.join(dir, 'features/checkout/domain/New.ts')), true);
  assert.deepEqual(fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith(`construct-txn-${process.pid}-`)), [], 'the shadow copy is gone');
});
