import { total, formatTotal } from './lib.mjs';

/** Sum a cart, label it, and post it to the API. */
export async function checkout(cart) {
  const amount = total(cart.lines);
  const label = formatTotal(amount);
  const res = await fetch(`https://shop.example/api/carts/${cart.id}/checkout?coupon=${cart.coupon}`, { method: 'POST' });
  return { label, ok: res.ok };
}
