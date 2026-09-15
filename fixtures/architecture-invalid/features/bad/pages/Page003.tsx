import { fetchFoo } from '../services/FooService';

export function Page003() {
  return <div>{String(!!fetchFoo)}</div>;
}
