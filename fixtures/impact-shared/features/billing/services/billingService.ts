import { totalBilling } from '../domain/billingRules';

export async function fetchBilling(): Promise<number> {
  const res = await fetch('/api/billing');
  return totalBilling(await res.json());
}
