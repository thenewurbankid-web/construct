// @line-base pages/ListPage
// @line-route /orders
import { ListPage } from '../../../library/pages/ListPage';

export function OrdersPage() {
  return <ListPage title="Orders" onMore={() => console.log('Show more orders')} />;
}
