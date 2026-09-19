import { fetchCheckout } from '../services/checkoutService';
import type { CheckoutState } from '../types';

export async function runCheckout(): Promise<{ state: CheckoutState; total: number }> {
  return { state: 'done', total: await fetchCheckout() };
}
