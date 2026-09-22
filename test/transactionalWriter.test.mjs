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

test('commit() with an empty transaction is a no-op success and never touches disk', () => {
  const dir = tmpProject();
  const txn = createTransaction(dir);
  const before = fs.readdirSync(path.join(dir, 'features', 'checkout', 'domain'));
  const result = txn.commit({ validate: validateArchitecture });
  assert.deepEqual(result, { committed: true, violations: [] });
  assert.deepEqual(fs.readdirSync(path.join(dir, 'features', 'checkout', 'domain')), before);
});

test('commit() cleans up its shadow temp directory whether it commits or aborts', () => {
  const dir = tmpProject();
  const before = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('construct-txn-'));

  const ok = createTransaction(dir);
  ok.writeFile('features/checkout/domain/Total.ts', `export function Total(){ return true; }\n`);
  ok.commit({ validate: validateArchitecture });

  const bad = createTransaction(dir);
  bad.writeFile('features/checkout/pages/Bad.tsx', `export function Bad(){ fetch('/'); return null; }\n`);
  bad.commit({ validate: validateArchitecture });

  const after = fs.readdirSync(os.tmpdir()).filter((f) => f.startsWith('construct-txn-'));
  assert.deepEqual(after, before, 'no construct-txn-* shadow dirs should be left behind');
});
