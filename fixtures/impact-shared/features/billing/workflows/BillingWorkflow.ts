import { fetchBilling } from '../services/billingService';
import type { BillingState } from '../types';

export async function runBilling(): Promise<{ state: BillingState; total: number }> {
  return { state: 'done', total: await fetchBilling() };
}
