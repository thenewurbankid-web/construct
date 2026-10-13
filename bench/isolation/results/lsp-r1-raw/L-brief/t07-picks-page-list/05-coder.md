```tsx
import { useState } from 'react';
import { listPicks, addPick, removePick } from '../store/picksStore';
import { Button } from '../../../library/components/Button';
import books from '../../../library/fixtures/books.json';

export function PicksPage() {
  const [ids, setIds] = useState<string[]>(() => listPicks());

  const handleRemove = (id: string) => {
    removePick(id);
    setIds(listPicks());
  };

  return (
    <ListPage title="My picks" empty={<p>No picked books</p>}>
      {ids.map((id, index) => (
        <article key={index}>
          {books.find((book) => book.id === id)}
          <Button label={`Remove ${books.find((book) => book.id === id)?.title}`} onClick={() => handleRemove(id)} />
        </article>
      ))}
    </ListPage>
  );
}
```