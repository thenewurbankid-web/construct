import type { Order } from '@/types/order';

interface OrdersViewProps {
  orders: Order[];
  total: string;
  onOpen: (id: string) => void;
  onTab: (tab: string) => void;
}

export function OrdersView({ orders, total, onOpen, onTab }: OrdersViewProps) {
  const [first] = orders;
  const empty = orders.length === 0;
  return (
    <div>
      {empty && <p>No orders</p>}
      {first ? <h2>{first.id}</h2> : null}
      <ul>
        {orders.map((o) => (
          <li key={o.id} onClick={() => onOpen(o.id)}>{o.id}</li>
        ))}
      </ul>
      <button onClick={() => onTab('open')}>Open</button>
      <span>{total}</span>
    </div>
  );
}
