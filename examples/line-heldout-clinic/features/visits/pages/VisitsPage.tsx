// @line-base pages/TablePage
// @line-route /visits
import { TablePage } from '../../../library/pages/TablePage';
import { PatientRow } from '../../patients/components/PatientRow';

export function VisitsPage() {
  return (
    <>
      <TablePage heading="Visits" />
      <PatientRow name="Today" />
    </>
  );
}
