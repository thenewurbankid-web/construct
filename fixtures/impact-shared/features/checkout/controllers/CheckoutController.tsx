'use client';
import { CheckoutPage } from '../pages/CheckoutPage';
import { useCheckout } from '../hooks/useCheckout';

export function CheckoutController() {
  const { start } = useCheckout();
  return <CheckoutPage total={0} onStart={start} />;
}
