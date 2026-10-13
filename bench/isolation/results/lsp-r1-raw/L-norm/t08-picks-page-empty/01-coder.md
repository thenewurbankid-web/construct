```tsx
import { ListPage } from '../../../library/pages/ListPage';
import { useState } from 'react';
import { listPicks, addPick, removePick } from '../store/picksStore';
import books from '../../../library/fixtures/books.json';

type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; summary: string; available: boolean };

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

// features/picks/store/picksStore.ts
export function listPicks(): string[] { ... }

export function addPick(id: string): void { ... }

export function removePick(id: string): void { ... }

export function PicksPage() {
  const [ids, setIds] = useState<string[]>(() => listPicks());
  const items = ids.map((id) => (books as Book[]).find((p) => p.id === id)).filter((p): p is Book => Boolean(p));
  return (
    <ListPage title="My picks" empty={<p>You have not picked any books yet</p>}>
      {items.length > 0 && items.map((item) => (
        <article key={item.id}>
          <h2>{item.title}</h2>
          <p>{item.author}</p>
          <Button label={`Remove ${item.title}`} onClick={() => { removeFromPicks(item.id); setIds(listPicks()); }} />
        </article>
      ))}
    </ListPage>
  );
}
```