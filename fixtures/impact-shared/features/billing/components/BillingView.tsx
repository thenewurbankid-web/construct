import { CurrencyLabel } from '../../shared/index';

type BillingViewProps = { total: number; onStart: () => void };

export function BillingView({ total, onStart }: BillingViewProps) {
  return (
    <section>
      <CurrencyLabel value={{ amount: total, currency: 'USD' }} />
      <button onClick={onStart}>Billing</button>
    </section>
  );
}
