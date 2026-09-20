import { BillingPage } from '../pages/BillingPage';
import { useBilling } from '../hooks/useBilling';

export function BillingController() {
  const { start } = useBilling();
  return <BillingPage onStart={start} />;
}
