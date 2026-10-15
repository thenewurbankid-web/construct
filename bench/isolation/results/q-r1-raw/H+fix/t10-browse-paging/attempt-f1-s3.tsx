'use client';
// @line-base pages/ListPage
// @line-route /
import Link from 'next/link';
import { ListPage } from '../../../library/pages/ListPage';
import { listBooks, type Book } from '../services/listBooks';
import { Button } from '../../../library/components/Button';
import { useState } from 'react';

export function BrowsePage() {
  const PAGE_SIZE = 6;
  const [page, setPage] = useState(1);
  const items = listBooks({});
  const pageCount = Math.ceil(items.length / PAGE_SIZE);
  const shown = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <>
      <ListPage title="Library catalogue" empty={<p>No books yet.</p>}>
        {shown.map((item) => (
          <article key={item.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4 shadow-sm">
            <h2 className="text-lg font-semibold"><Link href={`/books/${item.id}`}>{item.title}</Link></h2>
            <p>{item.author}</p>
            <p>{item.genre}</p>
            <p>{String(item.year)}</p>
            <p>{String(item.pages)}</p>
            <p>{String(item.available)}</p>
          </article>
        ))}
      </ListPage>
      <p>Page {page} of {pageCount}</p>
      <Button label="Previous page" disabled={page === 1} onClick={() => setPage(page - 1)} />
      <Button label="Next page" disabled={page === pageCount} onClick={() => setPage(page + 1)} />
    </>
  );
}
