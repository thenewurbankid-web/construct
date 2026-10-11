import { Badge } from './Badge';
import { Card } from './Card';

export function DataTable({ title, count }: { title: string; count: number }) {
  return (
    <div>
      <Card title={title} action="Refresh" />
      <Badge text={`${count} rows`} />
    </div>
  );
}
