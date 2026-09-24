import 'server-only';
import { charge } from '../features/shop/services/payments';
import { BuyButton } from './BuyButton';

// A server component may import services and read secrets: no 'use client' file reaches it.
export async function ServerPage() {
  const key = process.env.STRIPE_SECRET;
  const last = await charge(key ? 1 : 0);
  return <BuyButton last={last} />;
}
