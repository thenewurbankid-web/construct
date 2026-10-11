// @line-base pages/TablePage
// @line-route /patients
import { TablePage } from '../../../library/pages/TablePage';

export function PatientsPage() {
  return <TablePage heading="Patients" onRefresh={() => console.log('Reload patients')} />;
}
