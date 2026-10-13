```tsx
import { useState } from 'react';
import Link from 'next/link';
import { ListPage, Button } from '../../../library';
import books from '../../../library/fixtures/books.json';

type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; available: boolean };

export function BrowsePage() {
  const items = books as Book[];
  const itemsPerPage = 6;
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.ceil(items.length / itemsPerPage);

  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedItems = items.slice(startIndex, endIndex);

  const handlePreviousPage = () => {
    if (currentPage > 1) setCurrentPage(currentPage - 1);
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) setCurrentPage(currentPage + 1);
  };

  return (
    <ListPage title="Books" empty={<p>No books yet.</p>}>
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
      <div className="flex justify-center gap-2">
        <Button label="Previous page" disabled={currentPage === 1} onClick={handlePreviousPage} />
        <span>Page {currentPage} of {totalPages}</span>
        <Button label="Next page" disabled={currentPage === totalPages} onClick={handleNextPage} />
      </div>
    </ListPage>
  );
}
```