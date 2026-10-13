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

  return (
    <ListPage title="My picks" empty={<p>Your picks are empty</p>}>
      {ids.map((id) => {
        const book = books.find((b) => b.id === id);
        if (!book) return null;
        return (
          <article key={id}>
            <h2>{book.title}</h2>
            <p>{book.author}</p>
            <Button label={`Remove ${book.title}`} onClick={() => removePick(book.id)} />
          </article>
        );
      })}
    </ListPage>
  );
}
