import { Pill } from '../../../library/components/Pill';

export function VisitPill({ state }: { state: string }) {
  return <Pill text={state} />;
}
