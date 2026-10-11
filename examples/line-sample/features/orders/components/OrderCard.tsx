// @line-base components/Card
import { Card } from '../../../library/components/Card';

export function OrderCard({ id }: { id: string }) {
  return <Card title={`Order ${id}`} action="Open" />;
}
