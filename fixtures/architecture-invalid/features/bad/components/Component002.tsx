import { FooController } from '../controllers/FooController';

export function Component002() {
  return <div>{String(!!FooController)}</div>;
}
