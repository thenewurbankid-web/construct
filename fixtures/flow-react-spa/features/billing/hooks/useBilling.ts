import { billingWorkflow } from '../workflows/BillingWorkflow';

export function useBilling() {
  return { start: () => billingWorkflow };
}
