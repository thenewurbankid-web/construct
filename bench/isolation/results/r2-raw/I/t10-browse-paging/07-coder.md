```tsx
import Link from 'next/link';
import { ListPage } from '../../../library/pages/ListPage';
import books from '../../../library/fixtures/books.json';
import { Button } from '../../../library/components/Button';
import { useState } from 'react';

type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; available: boolean };

const PAGE_SIZE = 6;

export function BrowsePage() {
  const [currentPage, setPage] = useState(0);
  const items = books as Book[];
  const pageCount = Math.ceil(items.length / PAGE_SIZE);
  const shown = items.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);
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
      <div className="flex justify-center mt-4">
        {currentPage > 0 && (
          <Button label="Previous" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)} />
        )}
        <span className="ml-2">Page {currentPage + 1} of {pageCount}</span>
        {currentPage < pageCount - 1 && (
          <Button label="Next" disabled={currentPage === pageCount - 1} onClick={() => setPage(currentPage + 1)} />
        )}
      </div>
    </>
  );
}
```