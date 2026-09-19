import { CheckoutView } from '../components/CheckoutView';

type CheckoutPageProps = { total: number; onStart: () => void };

export function CheckoutPage({ total, onStart }: CheckoutPageProps) {
  return <CheckoutView total={total} onStart={onStart} />;
}
