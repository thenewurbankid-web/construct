```tsx
import { ListPage } from '../../../library/pages/ListPage';
import { useState } from 'react';
import { pickedBooks, type Book } from '../services/pickedBooks';
import { listPicks, addPick, removePick } from '../store/picksStore';
import { Button } from '../../../library/components/Button';

const PICKS_PAGE_TITLE = "My picks";
const PICKS_PAGE_EMPTY_TEXT = "No books in your picks.";

export function PicksPage() {
  const [ids, setIds] = useState<string[]>(() => listPicks());
  const items = pickedBooks({ ids });

  return (
    <ListPage title={PICKS_PAGE_TITLE} empty={<p>{PICKS_PAGE_EMPTY_TEXT}</p>}>
      {items.length > 0 && items.map((item) => (
        <article key={item.id}>
          <h2>{item.title}</h2>
          <p>{item.author}</p>
          <Button label={`Remove ${item.title}`} onClick={() => { removePick(item.id); setIds(listPicks()); }} />
        </article>
      ))}
    </ListPage>
  );
}
```