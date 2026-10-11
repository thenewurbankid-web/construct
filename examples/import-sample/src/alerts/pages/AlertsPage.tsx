import { Card } from '@/ui/Card';
import { AlertRow } from '../components/AlertRow';
import { SeverityBadge } from '../components/SeverityBadge';
import { Table } from '../components/Table';
import { useAlerts } from '../hooks/useAlerts';

function AlertsPage() {
  const alerts = useAlerts();
  const unread = alerts.filter((a) => !a.read).length;
  return (
    <Card title="Alerts">
      <p>{unread} unread <SeverityBadge severity={3} /></p>
      <Table head={['Alert', 'Severity']}>
        {alerts.map((a) => <AlertRow key={a.id} alert={a} />)}
      </Table>
    </Card>
  );
}

export default AlertsPage;
