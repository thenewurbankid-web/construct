'use client';

// The layer graph lets a hook import a service, but this hook is a client module.
import { charge } from '../services/payments';

export function useCheckout() {
  return { pay: (amount: number) => charge(amount) };
}
