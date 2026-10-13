// @line-base pages/ListPage
// @line-route /
import Link from 'next/link';
import { ListPage,  } from '../../../library/pages/ListPage';
import { useState, useEffect } from 'react';
import books from '../../../library/fixtures/books.json';
import { Button } from '../../../library/components/Button';

type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; available: boolean };

export function BrowsePage() {
  const items = books as Book[];
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 6;
  const totalPages = Math.ceil(items.length / itemsPerPage);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [currentPage]);

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedItems = items.slice(startIndex, endIndex);

  return (
    <ListPage title="Books" empty={<p>No books yet.</p>}>
      {paginatedItems.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {paginatedItems.map((item) => (
            <article key={item.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4 shadow-sm">
              <h2 className="text-lg font-semibold"><Link href={`/books/${item.id}`}>{item.title}</Link></h2>
              <p>{item.author}</p>
              <p>{item.genre}</p>
              <p>{String(item.year)}</p>
              <p>{String(item.pages)}</p>
              <p>{String(item.available)}</p>
            </article>
          ))}
        </div>
      )}
      <div className="flex justify-center gap-2">
        <Button label="Previous page" onClick={handlePreviousPage} disabled={currentPage === 1} />
        <span className="text-sm">{`Page ${currentPage} of ${totalPages}`}</span>
        <Button label="Next page" onClick={handleNextPage} disabled={currentPage === totalPages} />
      </div>
    </ListPage>
  );
}
