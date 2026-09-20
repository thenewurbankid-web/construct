import { OrdersPage } from '../pages/OrdersPage';
import { useOrders } from '../hooks/useOrders';

export function OrdersController() {
  const { start } = useOrders();
  return <OrdersPage onStart={start} />;
}
