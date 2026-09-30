import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUnitPath } from './UnitPath.ts';

test('parseUnitPath strips the generator-added "Page" suffix and the extension', () => {
  assert.deepEqual(parseUnitPath('billing', 'BillingPage.tsx'), { feature: 'billing', layer: 'page', name: 'Billing' });
  assert.deepEqual(parseUnitPath('billing', 'sub/BillingPage.tsx'), { feature: 'billing', layer: 'page', name: 'Billing' });
});

test('parseUnitPath keeps a base name that does not end in "Page" as-is', () => {
  assert.deepEqual(parseUnitPath('billing', 'Billing.tsx'), { feature: 'billing', layer: 'page', name: 'Billing' });
});

test('parseUnitPath is null with nothing open', () => {
  assert.equal(parseUnitPath('', ''), null);
  assert.equal(parseUnitPath('billing', ''), null);
  assert.equal(parseUnitPath('', 'BillingPage.tsx'), null);
});
