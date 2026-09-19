import { useCallback } from 'react';
import { runBilling } from '../workflows/BillingWorkflow';

export function useBilling() {
  return { start: useCallback(() => runBilling(), []) };
}
