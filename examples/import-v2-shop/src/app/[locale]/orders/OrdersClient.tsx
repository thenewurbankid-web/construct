'use client';

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useOrdersQuery } from '@/hooks/useOrders';
import { formatTotal } from '@/utils/money';
import { OrdersView } from '@/components/OrdersView';

const TABS = ['all', 'open', 'closed'];

function buildOrdersUrl(tab: string): string {
  const params = new URLSearchParams();
  if (tab !== 'all') params.set('tab', tab);
  return `/orders?${params.toString()}`;
}

export default function OrdersClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState(TABS.includes(searchParams.get('tab') ?? '') ? String(searchParams.get('tab')) : 'all');
  const { data } = useOrdersQuery(tab);
  const total = formatTotal(data ?? []);
  const changeTab = (next: string) => {
    setTab(next);
    router.replace(buildOrdersUrl(next));
  };
  const open = (id: string) => router.push(`/orders/detail?id=${id}`);
  if (!data) {
    return <p>Loading</p>;
  }
  return <OrdersView orders={data} total={total} onOpen={open} onTab={changeTab} />;
}
