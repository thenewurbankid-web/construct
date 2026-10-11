// @line-base components/Row
import { Row } from '../../../library/components/Row';

export function PatientRow({ name }: { name: string }) {
  return <Row name={name} state="Waiting" />;
}
