// The route forwards params whole; parseOrderRoute (a domain unit) decides found / not-found.
import { OrderController } from '@/features/orders/controllers/OrderController';

export default function Page({ params }: { params: { id: string } }) {
  return <OrderController params={params} />;
}
