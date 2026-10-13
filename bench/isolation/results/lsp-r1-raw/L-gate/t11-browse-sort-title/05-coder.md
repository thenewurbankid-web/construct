```tsx
import Link from 'next/link';
import { ListPage } from '../../../library/pages/ListPage';
import books from '../../../library/fixtures/books.json';

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
  const items = books as Book[];
  const sortedItems = [...items].sort((a, b) => a.title.localeCompare(b.title));
  return (
    <ListPage title="Books" empty={<p>No books yet.</p>}>
      {sortedItems.length > 0 && sortedItems.map((item) => (
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
  );
}
```