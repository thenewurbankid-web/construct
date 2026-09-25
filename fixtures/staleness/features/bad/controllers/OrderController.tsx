// CONTROLLER-003 (off by default): the controller copies the hook's total into state of its own,
// so the page keeps showing the total of the render where the copy was taken.
import { useState } from 'react';
import { OrderPage } from '../pages/OrderPage';
import { useOrder } from '../hooks/useOrder';

export function OrderController() {
  const { state, select } = useOrder();
  const [total] = useState(state.total);
  return <OrderPage state={state} total={total} onSelect={select} />;
}
