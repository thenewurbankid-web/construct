'use client';

import { stripe } from '@/lib/stripeServer';

export function CheckoutController() {
  return <button onClick={() => stripe.charges.create({ amount: 100 })}>Pay</button>;
}
