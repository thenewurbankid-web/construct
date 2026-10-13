```tsx
import { ListPage } from '../../../library/pages/ListPage';
import { useState } from 'react';
import { listPicks, addPick, removePick } from '../store/picksStore';
import books from '../../../library/fixtures/books.json';

export function PicksPage() {
  const [ids, setIds] = useState<string[]>(() => listPicks());
  const items = ids.map((id) => (books as Book[]).find((b) => b.id === id)).filter((b): b is Book => Boolean(b));
  
  if (!items.length) {
    return (
      <ListPage title="You have not picked any books yet" empty={<p>Click the button below to request a pick!</p>}>
        <Button label="Request a pick!" onClick={() => addPick(books[0].id)} />
      </ListPage>
    );
  }
  
  return (
    <ListPage title="Picks">
      {items.map((item) => (
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