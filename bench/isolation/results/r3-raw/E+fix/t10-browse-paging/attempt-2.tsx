import Link from 'next/link';
import { ListPage } from '../../../library/pages/ListPage';
import books from '../../../library/fixtures/books.json';
import { useState } from 'react';
import { Button } from '../../../library/components/Button';

type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; available: boolean };

export function BrowsePage() {
  const items = books as Book[];
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 6;
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;

  return (
    <ListPage title="Books" empty={<p>No books yet.</p>}>
      {items.slice(startIndex, endIndex).map((item) => (
        <article key={item.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4 shadow-sm">
          <h2 className="text-lg font-semibold"><Link href={`/books/${item.id}`}>{item.title}</Link></h2>
          <p>{item.author}</p>
          <p>{item.genre}</p>
          <p>{String(item.year)}</p>
          <p>{String(item.pages)}</p>
          <p>{String(item.available)}</p>
        </article>
      ))}
      {items.length > itemsPerPage && (
        <div className="flex justify-center mt-4">
          <Button
            variant="secondary"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage(currentPage - 1)}
          >
            Previous Page
          </Button>
          <Button
            variant="primary"
            disabled={currentPage === Math.ceil(items.length / itemsPerPage)}
            onClick={() => setCurrentPage(currentPage + 1)}
          >
            Next Page
          </Button>
        </div>
      )}
    </ListPage>
  );
}
