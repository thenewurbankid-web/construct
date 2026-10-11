import { useParams } from 'react-router-dom';
import { SeverityBadge } from '../components/SeverityBadge';
import { useAlerts } from '../hooks/useAlerts';

export function AlertDetailPage() {
  const { id } = useParams();
  const alert = useAlerts().find((a) => a.id === id);
  if (!alert) return <p>No such alert.</p>;
  return (
    <article>
      <h1>{alert.title}</h1>
      <SeverityBadge severity={alert.severity} />
    </article>
  );
}
