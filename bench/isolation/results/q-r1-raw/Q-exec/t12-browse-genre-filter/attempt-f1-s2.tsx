'use client';
// @line-base pages/ListPage
// @line-route /
import Link from 'next/link';
import { ListPage } from '../../../library/pages/ListPage';
import { listBooks, type Book } from '../services/listBooks';
import { useState } from 'react';

export function BrowsePage() {
  const [genre, setGenre] = useState('all');
  const items = listBooks({ genre }).filter((item) => genre === 'all' || item.genre === genre);
  return (
    <ListPage title="Books" empty={<p>No books yet.</p>}>
      {items.length > 0 && items.map((item) => (
        <article key={item.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4 shadow-sm">
          <h2 className="text-lg font-semibold"><Link href={`/books/${item.id}`}>{item.title}</Link></h2>
          <p>{item.author}</p>
          <label htmlFor="genre">Genre</label>
          <select id="genre" value={genre} onChange={(e) => setGenre(e.target.value)}>
            <option value="all">All genres</option>
            <option value="Fiction">Fiction</option>
            <option value="History">History</option>
            <option value="Science">Science</option>
          </select>
          <p>{String(item.year)}</p>
          <p>{String(item.pages)}</p>
          <p>{String(item.available)}</p>
        </article>
      ))}
    </ListPage>
  );
}
