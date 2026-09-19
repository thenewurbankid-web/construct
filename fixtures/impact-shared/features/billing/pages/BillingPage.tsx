import { BillingView } from '../components/BillingView';

type BillingPageProps = { total: number; onStart: () => void };

export function BillingPage({ total, onStart }: BillingPageProps) {
  return <BillingView total={total} onStart={onStart} />;
}
