Change the `title` prop of the `ListPage` component in `PicksPage.tsx` to "My picks". Add an `empty` prop with the text "You have not picked any books yet" when the `listPicks` function returns an empty array.

```tsx
import { ListPage } from '../../../library/pages/ListPage';
import { listPicks } from '../store/picksStore';

export function PicksPage() {
  const picks = listPicks();
  const emptyText = picks.length === 0 ? 'You have not picked any books yet' : undefined;

  return (
    <ListPage
      title="My picks"
      empty={emptyText}
    />
  );
}
```