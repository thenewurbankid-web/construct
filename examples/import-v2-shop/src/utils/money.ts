import type { Order } from '@/types/order';

export const CURRENCY = 'USD';

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** The orders' total, in thousands above 1000. */
export function formatTotal(orders: Order[]): string {
  const sum = round(orders.reduce((s, o) => s + o.total, 0));
  return sum > 1000 ? `${round(sum / 1000)}k ${CURRENCY}` : `${sum} ${CURRENCY}`;
}

export function label(): string {
  return `Prices in ${CURRENCY}`;
}
