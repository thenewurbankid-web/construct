```tsx
import { ListPage } from '../../../library/pages/ListPage';
import { useState } from 'react';
import { pickedBooks, type Book } from '../services/pickedBooks';
import { listPicks, addPick, removePick } from '../store/picksStore';
import { Button } from '../../../library/components/Button';

export function PicksPage() {
  const [ids, setIds] = useState<string[]>(() => listPicks());
  const items = pickedBooks({ ids });
  return (
    <ListPage title="My picks" empty={<p>Your picks are empty</p>}>
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