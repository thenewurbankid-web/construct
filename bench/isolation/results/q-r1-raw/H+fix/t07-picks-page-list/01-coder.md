```tsx
import { ListPage } from '../../../library/pages/ListPage';
import { useState } from 'react';
import { pickedBooks, type Book } from '../services/pickedBooks';
import { listPicks, addPick, removePick } from '../store/picksStore';
import { Button } from '../../../library/components/Button';

const PICKS_PAGE_TITLE = 'My picks';
const PICKS_PAGE_EMPTY_TEXT = 'You have no picks yet';

export function PicksPage() {
  const [ids, setIds] = useState<string[]>(() => listPicks());

  const items = pickedBooks({ ids }).map((item) => ({
    ...item,
    removeButtonLabel: `${PICKS_PAGE_TITLE} - Remove ${item.title}`,
  }));

  return (
    <ListPage title={PICKS_PAGE_TITLE} empty={<p>{PICKS_PAGE_EMPTY_TEXT}</p>}>
      {items.length > 0 && items.map((item) => (
        <article key={item.id}>
          <h2>{item.title}</h2>
          <p>{item.author}</p>
          <Button
            label={item.removeButtonLabel}
            onClick={() => {
              removePick(item.id);
              setIds(listPicks());
            }}
          />
        </article>
      ))}
    </ListPage>
  );
}
```