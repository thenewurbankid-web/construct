```tsx
import { useState } from 'react';
import { listPicks, addPick, removePick } from '../store/picksStore';
import { Button } from '../../../library/components/Button';
import books from '../../../library/fixtures/books.json';

export function PicksPage() {
  const [ids, setIds] = useState<string[]>(() => listPicks());

  const items = ids.map((id) => {
    const book = books.find(book => book.id === id);
    if (book) return { ...book, title: book.title.toUpperCase(), author: book.author.toUpperCase() };
    return null;
  });

  const filteredItems = items.filter(Boolean);

  return (
    <ListPage
      title="My picks"
      empty={<p>Your picks are empty</p>}
      children={filteredItems.length > 0 && filteredItems.map((item) => (
        <article key={item.id}>
          <h2>{item.title}</h2>
          <p>{item.author}</p>
          <Button label={`Remove ${item.title}`} onClick={() => removePick(item.id)} />
        </article>
      ))}
    />
  );
}
```