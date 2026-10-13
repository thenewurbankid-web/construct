```tsx
import { ListPage } from '../../../library/pages/ListPage';
import { useState } from 'react';
import { listPicks, addPick, removePick } from '../store/picksStore';
import books from '../../../library/fixtures/books.json';

type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; summary: string; available: boolean };

export function PicksPage() {
  const [ids, setIds] = useState<string[]>(() => listPicks());

  const items = ids.map((id) => (books as Book[]).find((p) => p.id === id)).filter((p): p is Book => Boolean(p));

  return (
    <ListPage title="My picks" empty={<p>You have not picked any books yet</p>}>
      {items.length > 0 && items.map((item) => (
        <article key={item.id}>
          <h2>{item.title}</h2>
          <p>{item.author}</p>
          <Button label={`Remove ${item.title}`} onClick={() => removePick(item.id)} />
        </article>
      ))}
    </ListPage>
  );
}
```