'use client';

// The client calls a server action; the action is the only place the service is imported.
import { payAction } from '@/actions/checkout';

export function useCheckout() {
  return { pay: (amount: number) => payAction(amount) };
}
