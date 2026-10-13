**FUNCTION:** `PicksPage`

**SIGNATURE:** 
```tsx
export function PicksPage(): JSX.Element;
```

**IMPORTS:** 
```tsx
import { ListPage } from '../../../library/pages/ListPage';
import { listPicks } from '../store/picksStore';
```

**CHANGE:**
- **Change 1:** Replace the `title` prop in the `ListPage` component with the string `"My picks"`.
- **Change 2:** Add a conditional rendering for the `empty` prop in the `ListPage` component. If `listPicks()` returns an empty array, render the string `"You have not picked any books yet"`. Otherwise, render `null`.

**EXAMPLE:**
```tsx
import { ListPage } from '../../../library/pages/ListPage';
import { listPicks } from '../store/picksStore';

export function PicksPage() {
  const picks = listPicks();
  const emptyContent = picks.length === 0 ? 'You have not picked any books yet' : null;

  return <ListPage title="My picks" empty={emptyContent} />;
}
```