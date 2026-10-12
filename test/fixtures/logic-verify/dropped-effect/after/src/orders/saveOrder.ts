import { api } from '../api';

export async function saveOrder(order: { id: string; total: number }): Promise<void> {
  await api.post('/orders', order);
}
