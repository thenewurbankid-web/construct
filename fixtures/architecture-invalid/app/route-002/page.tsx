import { FooController } from '../../features/bad/controllers/FooController';

export default function Page() {
  fetch('/api/foo');
  return <FooController />;
}
