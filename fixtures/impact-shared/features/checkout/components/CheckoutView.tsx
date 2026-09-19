import { CurrencyLabel } from '../../shared/index';

type CheckoutViewProps = { total: number; onStart: () => void };

export function CheckoutView({ total, onStart }: CheckoutViewProps) {
  return (
    <section>
      <CurrencyLabel value={{ amount: total, currency: 'USD' }} />
      <button onClick={onStart}>Checkout</button>
    </section>
  );
}
