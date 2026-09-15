import { FooWorkflow } from '../workflows/FooWorkflow';

export function Page002() {
  return <div>{String(!!FooWorkflow)}</div>;
}
