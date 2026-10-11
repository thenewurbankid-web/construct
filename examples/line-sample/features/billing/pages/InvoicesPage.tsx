// @line-base pages/ListPage
// @line-route /billing
import { ListPage } from '../../../library/pages/ListPage';
import { OrderButton } from '../../orders/components/OrderButton';

export function InvoicesPage() {
  return (
    <>
      <ListPage title="Invoices" />
      <OrderButton />
    </>
  );
}
