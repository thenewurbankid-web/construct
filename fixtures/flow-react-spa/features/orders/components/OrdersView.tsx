import { CurrencyLabel } from '../../shared';

export function OrdersView({ onStart }: { onStart: () => void }) {
  return <button onClick={onStart}><CurrencyLabel amount={0} /></button>;
}
