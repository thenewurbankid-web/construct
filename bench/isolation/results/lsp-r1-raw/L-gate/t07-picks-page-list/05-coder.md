```tsx
import { useState } from 'react';
import { ListPage } from '../../../library/pages/ListPage';
import { useCart } from '../store/cartStore';
import { Button } from '../../../library/components/Button';
import books from '../../../library/fixtures/books.json';

export function PicksPage() {
  const [ids, setIds] = useState<string[]>(() => listPicks());
  const cartItems = useCart();
  const items = ids.map((id) => {
    const book = books.find((b) => b.id === id);
    return book && { ...book, removed: cartItems.includes(id) };
  }).filter((item): item is PickItem => Boolean(item));
  return (
    <ListPage title="My picks" empty={<p>Your picks are empty</p>}>
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