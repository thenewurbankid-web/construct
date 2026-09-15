import { fetchFoo } from '../services/FooService';

export function Component003() {
  return <div>{String(!!fetchFoo)}</div>;
}
