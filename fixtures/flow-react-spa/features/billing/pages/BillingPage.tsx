import { BillingView } from '../components/BillingView';

export function BillingPage({ onStart }: { onStart: () => void }) {
  return <BillingView onStart={onStart} />;
}
