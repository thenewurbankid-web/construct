'use client';
// @line-base pages/ListPage
// @line-route /picks
import { ListPage } from '../../../library/pages/ListPage';
import { listPicks, addPick, removePick } from '../store/picksStore';
import { useState } from 'react';

export function PicksPage() {
  const [ids, setIds] = useState<string[]>(() => listPicks());
  const items = cartProducts({ ids });
  
  return (
    <ListPage title="My picks" empty={<p>You have not picked any books yet</p>}>
      {items.length > 0 && items.map((item) => (
        <article key={item.id}>
          <h2>{item.name}</h2>
          <p>{item.maker}</p>
          <Button label={`Remove ${item.name}`} onClick={() => { removeFromCart(item.id); setIds(listPicks()); }} />
        </article>
      ))}
    </ListPage>
  );
}
