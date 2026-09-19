import { totalCheckout } from '../domain/checkoutRules';

export async function fetchCheckout(): Promise<number> {
  const res = await fetch('/api/checkout');
  return totalCheckout(await res.json());
}
