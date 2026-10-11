import type { Alert } from '../types';
import { SeverityBadge } from './SeverityBadge';

export function AlertRow({ alert }: { alert: Alert }) {
  return (
    <tr className={alert.read ? 'read' : 'unread'}>
      <td>{alert.title}</td>
      <td><SeverityBadge severity={alert.severity} /></td>
    </tr>
  );
}
