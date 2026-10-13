```tsx
import { useState } from 'react';
import { listPicks, addPick, removePick } from '../store/picksStore';
import { Button } from '../../../library/components/Button';
import books from '../../../library/fixtures/books.json';

export function PicksPage() {
  const [ids, setIds] = useState<string[]>(() => listPicks());

  return (
    <ListPage title="My picks" empty={<p>Your picks are empty</p>}>
      {ids.map((id) => {
        const book = books.find((b) => b.id === id);
        if (!book) return null;
        return (
          <article key={id}>
            <h2>{book.title}</h2>
            <p>{book.author}</p>
            <Button label={`Remove ${book.title}`} onClick={() => removePick(book.id)} />
          </article>
        );
      })}
    </ListPage>
  );
}
```