```tsx
import Link from 'next/link';
import { ListPage } from '../../../library/pages/ListPage';
import books from '../../../library/fixtures/books.json';
import React, { useState } from 'react';

type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; available: boolean };

export function BrowsePage() {
  const items = books as Book[];
  const [currentPage, setCurrentPage] = useState(1);
  const perPage = 6;
  const lastPage = Math.ceil(items.length / perPage);

  return (
    <ListPage title="Books" empty={<p>No books yet.</p>}>
      {items.length > 0 && items.slice((currentPage - 1) * perPage, currentPage * perPage).map((item) => (
        <article key={item.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4 shadow-sm">
          <h2 className="text-lg font-semibold"><Link href={`/books/${item.id}`}>{item.title}</Link></h2>
          <p>{item.author}</p>
          <p>{item.genre}</p>
          <p>{String(item.year)}</p>
          <p>{String(item.pages)}</p>
          <p>{String(item.available)}</p>
        </article>
      ))}
      {currentPage !== 1 && (
        <Button onClick={() => setCurrentPage(currentPage - 1)} disabled={currentPage === 1}>
          Previous
        </Button>
      )}
      {currentPage < lastPage && (
        <Button onClick={() => setCurrentPage(currentPage + 1)} disabled={currentPage === lastPage}>
          Next
        </Button>
      )}
    </ListPage>
  );
}
```