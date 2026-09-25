// What the controller binder emits: the hook is read live on every render, nothing is stored.
import { OrderPage } from '../pages/OrderPage';
import { useOrder } from '../hooks/useOrder';

export function OrderController() {
  const { state, select } = useOrder();
  return <OrderPage state={state} onSelect={select} />;
}
