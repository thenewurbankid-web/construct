'use server';

import { charge } from '../features/shop/services/payments';

export async function payAction(amount: number) {
  if (!process.env.STRIPE_SECRET) throw new Error('STRIPE_SECRET is not set');
  return charge(amount);
}
