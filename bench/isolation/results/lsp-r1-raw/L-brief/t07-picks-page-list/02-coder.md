```tsx
import { useState } from 'react';
import { listPicks, addPick, removePick } from '../store/picksStore';
import { Button } from '../../../library/components/Button';
import books from '../../../library/fixtures/books.json';

type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; summary: string; available: boolean };

export function PicksPage() {
  const [ids, setIds] = useState<string[]>(() => listPicks());
  const booksMap = new Map(book.id, book);
  const items = ids.map((id) => (books as Book[]).find((b) => b.id === id)).filter((b): b is Book => Boolean(b));
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