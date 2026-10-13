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
