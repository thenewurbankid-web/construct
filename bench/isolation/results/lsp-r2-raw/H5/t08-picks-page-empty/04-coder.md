```tsx
import { ListPage } from '../../../library/pages/ListPage';
import { useState } from 'react';
import { listPicks, addPick, removePick } from '../store/picksStore';

export function PicksPage() {
  const [ids, setIds] = useState<string[]>(() => listPicks());

  if (ids.length === 0) {
    return (
      <ListPage title="You have not picked any books yet" empty={<p>Try adding some picks!</p>} />
    );
  }

  const items = cartProducts({ ids });
  return (
    <ListPage title="Picks">
      {items.map((item) => (
        <article key={item.id}>
          <h2>{item.name}</h2>
          <p>{item.maker}</p>
          <Button label={`Remove ${item.name}`} onClick={() => { removeFromCart(item.id); setIds(listPicks()); }} />
        </article>
      ))}
    </ListPage>
  );
}
```