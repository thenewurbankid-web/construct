```tsx
import Link from 'next/link';
import { ListPage } from '../../../library/pages/ListPage';
import { listBooks, type Book } from '../services/listBooks';

export function BrowsePage() {
  const items = listBooks({});
  return (
    <ListPage title="Library catalogue" empty={<p>No books yet.</p>}>
      {items.length > 0 && items.map((item) => (
        <article key={item.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4 shadow-sm">
          <h2 className="text-lg font-semibold"><Link href={`/books/${item.id}`}>{item.title}</Link></h2>
          <p>{item.author}</p>
          <p>{item.genre}</p>
          <p>{String(item.year)}</p>
          <p>{String(item.pages)}</p>
          <p>{item.available ? 'Available' : 'On loan'}</p>
        </article>
      ))}
    </ListPage>
  );
}
```