// ROUTE-003 (off by default): the route reads the raw id string itself, so an id that no longer
// names anything travels inward as a string instead of becoming a not-found state.
import { OrderController } from '@/features/orders/controllers/OrderController';

export default function Page({ params }: { params: { id: string } }) {
  return <OrderController orderId={params.id} />;
}
