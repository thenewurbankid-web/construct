import { Card } from '../../../library/components/Card';

export function InvoiceCard({ id }: { id: string }) {
  return <Card title={`Invoice ${id}`} action="Pay" />;
}
