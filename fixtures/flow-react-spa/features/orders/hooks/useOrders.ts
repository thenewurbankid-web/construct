import { ordersWorkflow } from '../workflows/OrdersWorkflow';

export function useOrders() {
  return { start: () => ordersWorkflow };
}
