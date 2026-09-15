import { calcFoo } from '../domain/calcFoo';

export function Page005() {
  return <div>{String(!!calcFoo)}</div>;
}
