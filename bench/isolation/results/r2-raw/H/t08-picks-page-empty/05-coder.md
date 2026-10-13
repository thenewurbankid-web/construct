```tsx
import { ListPage } from '../../../library/pages/ListPage';
import { useState } from 'react';
import { listPicks, addPick, removePick } from '../store/picksStore';
import books from '../../../library/fixtures/books.json';

export function PicksPage() {
  const [ids, setIds] = useState<string[]>(() => listPicks());

  const filteredBooks = books.filter((book) => ids.includes(book.id));

  return (
    <ListPage title="My picks">
      {filteredBooks.length === 0 ? (
        <p>You have not picked any books yet</p>
      ) : (
        filteredBooks.map((book) => (
          <article key={book.id}>
            <h2>{book.title}</h2>
            <p>{book.author}</p>
            <Button label={`Remove ${book.title}`} onClick={() => { removePick(book.id); setIds(listPicks()); }} />
          </article>
        ))
      )}
    </ListPage>
  );
}
```