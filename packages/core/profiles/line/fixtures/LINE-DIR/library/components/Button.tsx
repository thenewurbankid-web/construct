import type { OrdersPage } from '@/features/orders/pages/OrdersPage';

export type Unused = typeof OrdersPage;

export function Button({ label }: { label: string }) {
  return <button type="button">{label}</button>;
}
