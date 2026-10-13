```tsx
import { useState } from 'react';
import { listPicks, addPick, removePick } from '../store/picksStore';
import { Button } from '../../../library/components/Button';
import books from '../../../library/fixtures/books.json';

type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; summary: string; available: boolean };

const PicksPage = () => {
  const [ids, setIds] = useState<string[]>(() => listPicks());

  return (
    <ListPage
      title="My picks"
      empty={<p>Your picks are empty</p>}
    >
      {ids.map((id) => {
        const book = books.find((b) => b.id === id);
        if (!book) {
          return null;
        }
        return (
          <article key={id}>
            <h2>{book.title}</h2>
            <p>Author: {book.author}</p>
            <Button
              label={`Remove ${book.title}`}
              onClick={() => removePick(id)}
            />
          </article>
        );
      })}
    </ListPage>
  );
};

export default PicksPage;
```