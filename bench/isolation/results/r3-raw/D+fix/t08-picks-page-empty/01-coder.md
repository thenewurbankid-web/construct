```tsx
// @line-base pages/ListPage
// @line-route /picks
import { ListPage } from '../../../library/pages/ListPage';
import { listPicks } from '../store/picksStore';

export function PicksPage() {
  const picks = listPicks();
  const emptyText = "You have not picked any books yet";

  return (
    <ListPage
      title="My picks"
      empty={picks.length === 0 ? emptyText : undefined}
    />
  );
}
```