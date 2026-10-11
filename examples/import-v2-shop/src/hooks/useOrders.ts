import { useEffect, useState } from 'react';
import type { Order } from '@/types/order';

export function useOrdersQuery(tab: string): { data: Order[] | null } {
  const [data, setData] = useState<Order[] | null>(null);
  useEffect(() => {
    fetch(`/api/orders?tab=${tab}`).then((r) => r.json()).then(setData);
  }, [tab]);
  return { data };
}
