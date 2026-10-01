import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageImpact } from './pagesImpact.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const SHARED = path.join(REPO, 'fixtures', 'impact-shared');

test('pageImpact: a page nobody else imports touches 0 other features', () => {
  const r = pageImpact(SHARED, 'billing', 'BillingPage.tsx');
  assert.equal(r.ok, true);
  assert.deepEqual(r.features, []);
});

test('pageImpact: a page another feature newly imports shows up as impact', (t) => {
  // #379 -- proves the signal reacts to a real import edge, not a hardcoded value: checkout's
  // page importing billing's page is an unusual pattern (pages are normally leaves) but it is a
  // real graph edge, which is all the impact engine's importers() traversal cares about.
  const checkoutPage = path.join(SHARED, 'features/checkout/pages/CheckoutPage.tsx');
  const before = fs.readFileSync(checkoutPage, 'utf8');
  fs.writeFileSync(checkoutPage, `import '../../billing/pages/BillingPage';\n${before}`);
  t.after(() => fs.writeFileSync(checkoutPage, before));

  const r = pageImpact(SHARED, 'billing', 'BillingPage.tsx');
  assert.equal(r.ok, true);
  assert.deepEqual(r.features, ['checkout']);
});

test('pageImpact: an unknown feature/file fails closed (resolvePageFile throws, never a crash)', () => {
  assert.throws(() => pageImpact(SHARED, 'billing', '../../../etc/passwd'));
});
