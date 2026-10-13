```tsx
// @line-base pages/ListPage
// @line-route /picks
import { ListPage } from '../../../library/pages/ListPage';
import { listPicks } from '../store/picksStore';

const EMPTY_TEXT = "You have not picked any books yet";

export function PicksPage() {
  const picks = listPicks();
  const hasPicks = picks.length > 0;

  return (
    <ListPage
      title="My picks"
      empty={hasPicks ? undefined : EMPTY_TEXT}
    />
  );
}
```