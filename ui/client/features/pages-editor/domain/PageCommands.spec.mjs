import test from 'node:test';
import assert from 'node:assert/strict';
import { pageCommandSpecs } from './PageCommands.ts';

test('pageCommandSpecs: one command per page, stable id, titled and grouped for quick-open', () => {
  const specs = pageCommandSpecs([
    { feature: 'auth', file: 'LoginPage.tsx' },
    { feature: 'billing', file: 'InvoicePage.tsx' },
  ]);
  assert.equal(specs.length, 2);
  assert.deepEqual(specs.map((s) => s.id), ['page.auth/LoginPage.tsx', 'page.billing/InvoicePage.tsx']);
  assert.equal(specs[0].title, 'Go to auth/LoginPage.tsx');
  assert.ok(specs.every((s) => s.group === 'Go to page'));
  assert.deepEqual(specs[0].keywords, ['open', 'page', 'file', 'auth', 'LoginPage.tsx']);
});

test('pageCommandSpecs: empty list gives no commands', () => {
  assert.deepEqual(pageCommandSpecs([]), []);
});
