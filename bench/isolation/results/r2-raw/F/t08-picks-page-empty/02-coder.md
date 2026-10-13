```tsx
import { ListPage } from '../../../library/pages/ListPage';
import { listPicks } from '../store/picksStore';

export function PicksPage() {
  const picks = listPicks();
  const emptyContent = picks.length === 0 ? 'You have not picked any books yet' : null;

  return <ListPage title="My picks" empty={emptyContent} />;
}
```