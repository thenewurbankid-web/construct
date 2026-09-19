'use client';
import { BillingPage } from '../pages/BillingPage';
import { useBilling } from '../hooks/useBilling';

export function BillingController() {
  const { start } = useBilling();
  return <BillingPage total={0} onStart={start} />;
}
