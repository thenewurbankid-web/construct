import { CheckoutController } from '../../features/checkout/controllers/CheckoutController';

export default function Page() {
  fetch('/api/checkout');
  return <CheckoutController />;
}
