// Run by test/line-graph-runtime.test.mjs as `node --import <graph/runtime/register.mjs> --test app.spec.mjs`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkout } from './app.mjs';
import { total } from './lib.mjs';

test('checkout sums, labels and posts the cart', async () => {
  globalThis.__lineRuntimeTest = 'checkout sums, labels and posts the cart';
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true });
  try {
    const r = await checkout({ id: 'cart-8842', coupon: 'GLOBEX77', lines: [{ sku: 'Quartz Kettle', qty: 3, price: 19.5 }] });
    assert.deepEqual(r, { label: '58.50 EUR', ok: true });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test('total alone', () => {
  globalThis.__lineRuntimeTest = 'total alone';
  assert.equal(total([{ sku: 'Quartz Kettle', qty: 2, price: 4 }]), 8);
});
