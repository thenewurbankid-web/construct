'use client';
// @line-base pages/ListPage
// @line-route /picks
import { ListPage } from '../../../library/pages/ListPage';
import books from '../../../library/fixtures/books.json';
import { Button } from '../../../library/components/Button';
import { listPicks, addPick, removePick } from '../store/picksStore';
import { useState } from 'react';

type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; summary: string; available: boolean };

export function PicksPage() {
  const [ids, setIds] = useState<string[]>(() => listPicks());

  const items = ids.map((id) => {
    const book = books.find(book => book.id === id);
    if (book) return { ...book, id };
    else return null;
  }).filter(Boolean);

  return (
    <ListPage title="My picks" empty={<p>No picks yet</p>}>
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
