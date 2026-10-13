'use client';
// @line-base pages/ListPage
// @line-route /picks
import { useState } from 'react';
import { ListPage } from '../../../library/pages/ListPage';
import { Button } from '../../../library/components/Button';
import { pickedBooks, type Book } from '../services/pickedBooks';
import { listPicks, removePick } from '../store/picksStore';

export function PicksPage() {
  const [picks, setPicks] = useState<string[]>(() => listPicks());
  const items = pickedBooks({ ids: picks });
  return (
    <ListPage title="My picks" empty={<p>You have not picked any books yet</p>}>
      {items.length > 0 && items.map((item) => (
        <article key={item.id}>
          <h2>{item.title}</h2>
          <p>{item.author}</p>
          <Button label={`Remove ${item.title}`} onClick={() => { removePick(item.id); setPicks(listPicks()); }} />
        </article>
      ))}
    </ListPage>
  );
}
