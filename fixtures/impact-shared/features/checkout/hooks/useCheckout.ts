import { useCallback } from 'react';
import { runCheckout } from '../workflows/CheckoutWorkflow';

export function useCheckout() {
  return { start: useCallback(() => runCheckout(), []) };
}
