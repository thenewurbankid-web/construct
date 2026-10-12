import { api } from '../api';
import { toast } from '../toast';

export async function saveOrder(order: { id: string; total: number }): Promise<void> {
  await api.post('/orders', order);
  toast.success('Order saved');
}
