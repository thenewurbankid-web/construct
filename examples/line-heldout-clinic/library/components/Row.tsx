import { Pill } from './Pill';

export function Row({ name, state }: { name: string; state: string }) {
  return (
    <li>
      {name} <Pill text={state} />
    </li>
  );
}
