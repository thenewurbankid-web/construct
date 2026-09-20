import { OrdersView } from '../components/OrdersView';

export function OrdersPage({ onStart }: { onStart: () => void }) {
  return <OrdersView onStart={onStart} />;
}
