import { CurrencyLabel } from '../../shared';

export function BillingView({ onStart }: { onStart: () => void }) {
  return <button onClick={onStart}><CurrencyLabel amount={0} /></button>;
}
