import { Detail } from './opp/pages/Detail';
import { Detail as DetailNext } from './opp/pages/Detail-v2';

export function App({ next }: { next: boolean }) {
  if (next) return <DetailNext />;
  return <Detail />;
}
