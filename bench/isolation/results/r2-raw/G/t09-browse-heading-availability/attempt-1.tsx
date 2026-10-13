// @line-base pages/ListPage
// @line-route /
import Link from 'next/link';
import { ListPage } from '../../../library/pages/ListPage';
import books from '../../../library/fixtures/books.json';

type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; available: boolean };

export function BrowsePage() {
  const items = books as Book[];
  return (
    <ListPage title="Library catalogue" empty={<p>No books yet.</p>}>
      {items.length > 0 && items.map((item) => (
        <article key={item.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4 shadow-sm">
          <h2 className="text-lg font-semibold"><Link href={`/books/${item.id}`}>{item.title}</Link></h2>
          <p>{item.author}</p>
          <p>{item.genre}</p>
          <p>{String(item.year)}</p>
          <p>{String(item.pages)}</p>
          <p>{item.available ? 'Available' : 'Not available'}</p>
        </article>
      ))}
    </ListPage>
  );
}

export default BrowsePage;
// @line-base pages/ListPage
// @line-route /books/:id
import Link from 'next/link';
import { ListPage } from '../../../library/pages/ListPage';
import books from '../../../library/fixtures/books.json';

type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; available: boolean };

export function BookPage() {
  const items = books as Book[];
  const book = items.find((item) => item.id === params.id);
  if (!book) {
    return <p>Book not found.</p>;
  }
  return (
    <ListPage title={book.title} empty={<p>No book yet.</p>}>
      <article key={book.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4 shadow-sm">
        <h2 className="text-lg font-semibold">{book.title}</h2>
        <p>{book.author}</p>
        <p>{book.genre}</p>
        <p>{String(book.year)}</p>
        <p>{String(book.pages)}</p>
        <p>{book.available ? 'Available' : 'Not available'}</p>
      </article>
    </ListPage>
  );
}
// @line-base pages/ListPage
// @line-route /books/:id
import Link from 'next/link';
import { ListPage } from '../../../library/pages/ListPage';
import books from '../../../library/fixtures/books.json';

type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; available: boolean };

export function BookPage() {
  const items = books as Book[];
  const book = items.find((item) => item.id === params.id);
  if (!book) {
    return <p>Book not found.</p>;
  }
  return (
    <ListPage title={book.title} empty={<p>No book yet.</p>}>
      <article key={book.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4 shadow-sm">
        <h2 className="text-lg font-semibold">{book.title}</h2>
        <p>{book.author}</p>
        <p>{book.genre}</p>
        <p>{String(book.year)}</p>
        <p>{String(book.pages)}</p>
        <p>{book.available ? 'Available' : 'Not available'}</p>
      </article>
    </ListPage>
  );
}
// @line-base pages/ListPage
// @line-route /books/:id
import Link from 'next/link';
import { ListPage } from '../../../library/pages/ListPage';
import books from '../../../library/fixtures/books.json';

type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; available: boolean };

export function BookPage() {
  const items = books as Book[];
  const book = items.find((item) => item.id === params.id);
  if (!book) {
    return <p>Book not found.</p>;
  }
  return (
    <ListPage title={book.title} empty={<p>No book yet.</p>}>
      <article key={book.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4 shadow-sm">
        <h2 className="text-lg font-semibold">{book.title}</h2>
        <p>{book.author}</p>
        <p>{book.genre}</p>
        <p>{String(book.year)}</p>
        <p>{String(book.pages)}</p>
        <p>{book.available ? 'Available' : 'Not available'}</p>
      </article>
    </ListPage>
  );
}
// @line-base pages/ListPage
// @line-route /books/:id
import Link from 'next/link';
import { ListPage } from '../../../library/pages/ListPage';
import books from '../../../library/fixtures/books.json';

type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; available: boolean };

export function BookPage() {
  const items = books as Book[];
  const book = items.find((item) => item.id === params.id);
  if (!book) {
    return <p>Book not found.</p>;
  }
  return (
    <ListPage title={book.title} empty={<p>No book yet.</p>}>
      <article key={book.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4 shadow-sm">
        <h2 className="text-lg font-semibold">{book
        </article>
      ))}
    </ListPage>
  );
}
