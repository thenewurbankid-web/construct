'use client';

import type { Payment } from '../features/shop/services/payments';
import { type Payment as Receipt } from '../features/shop/services/payments';
import { apiUrl } from '@/lib/publicConfig';
import { useCheckout } from '../features/shop/hooks/useCheckout';

export function BuyButton({ last }: { last?: Payment | Receipt }) {
  const { pay } = useCheckout();
  return <button data-api={apiUrl} data-last={last?.id} onClick={() => pay(10)}>Buy</button>;
}
