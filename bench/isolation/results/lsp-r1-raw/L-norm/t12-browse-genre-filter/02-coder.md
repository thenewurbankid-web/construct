```tsx
import Link from 'next/link';
import { ListPage } from '../../../library/pages/ListPage';
import books from '../../../library/fixtures/books.json';
import { useState } from 'react';

export type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; available: boolean };

// library/pages/ListPage.tsx
export type ListPageProps = {
  title: string;
  /** Filters and search above the list. */
  toolbar?: ReactNode;
  /** The items, laid out as a grid. */
  children?: ReactNode;
  /** Shown instead of the grid when there is nothing to list. */
  empty?: ReactNode;
};

export function ListPage({ title, toolbar, children, empty }: ListPageProps) { ... }

export function BrowsePage() {
  const [genre, setGenre] = useState('All genres');
  const items = books as Book[];
  const filteredItems = genre === 'All genres' ? items : items.filter((item) => item.genre === genre);
  const toolbar = (
    <>
      <label htmlFor="genre">Genre</label>
      <select id="genre" value={genre} onChange={(e) => setGenre(e.target.value)}>
        <option value="All genres">All genres</option>
        <option value="Fiction">Fiction</option>
        <option value="History">History</option>
        <option value="Science">Science</option>
      </select>
    </>
  );
  return (
    <ListPage title="Books" toolbar={toolbar}>{filteredItems.length > 0 && filteredItems.map((item) => (
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
}
```