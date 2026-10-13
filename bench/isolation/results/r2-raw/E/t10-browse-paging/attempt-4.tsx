import React, { useState } from 'react';
import Link from 'next/link';
import { ListPage } from '../../../library/pages/ListPage';
import books from '../../../library/fixtures/books.json';

type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; available: boolean };

export function BrowsePage() {
  const items = books as Book[];
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.ceil(items.length / 6);

  const isFirstPage = currentPage === 1;
  const isLastPage = currentPage === totalPages;

  return (
    <ListPage title="Books" empty={<p>No books yet.</p>}>
      {items.length > 0 && items.slice((currentPage - 1) * 6, currentPage * 6).map((item) => (
        <article key={item.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4 shadow-sm">
          <h2 className="text-lg font-semibold"><Link href={`/books/${item.id}`}>{item.title}</Link></h2>
          <p>{item.author}</p>
          <p>{item.genre}</p>
          <p>{String(item.year)}</p>
          <p>{String(item.pages)}</p>
          <p>{String(item.available)}</p>
        </article>
      ))}
      {totalPages > 1 && (
        <div className="flex items-center justify-center mt-8">
          <button
            disabled={isFirstPage}
            onClick={() => setCurrentPage(currentPage - 1)}
            className="inline-flex items-center justify-center rounded-md border border-slate-200 px-4 py-2 text-sm font-semibold uppercase transition duration-50 ease-in-out hover:bg-blue-700 hover:text-white focus-visible:bg-blue-700 focus-visible:text-white"
          >
            Previous
          </button>
          <button
            disabled={isLastPage}
            onClick={() => setCurrentPage(currentPage + 1)}
            className="inline-flex items-center justify-center rounded-md border border-slate-200 px-4 py-2 text-sm font-semibold uppercase transition duration-50 ease-in-out hover:bg-blue-700 hover:text-white focus-visible:bg-blue-700 focus-visible:text-white"
          >
            Next
          </button>
        </div>
      )}
    </ListPage>
  );
}
