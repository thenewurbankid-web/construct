```tsx
import { ListPage } from '../../../library/pages/ListPage';
import { useState } from 'react';
import { listPicks, addPick, removePick } from '../store/picksStore';
import books from '../../../library/fixtures/books.json';

type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; summary: string; available: boolean };

function listPicks(): string[]
function addPick(id: string): void
function removePick(id: string): void

// features/picks/store/picksStore.ts
function listPicks(): string[]
function addPick(id: string): void
function removePick(id: string): void

// library/pages/ListPage.tsx
type ListPageProps = { title: string; toolbar?: ReactNode; children?: ReactNode; empty?: ReactNode; }
function ListPage({ title, toolbar, children, empty }: ListPageProps): React.JSX.Element

export function PicksPage() {
  const [ids, setIds] = useState<string[]>(() => listPicks());

  if (ids.length === 0) {
    return (
      <ListPage title="My picks" empty={<p>You have not picked any books yet</p>}>
        {children}
      </ListPage>
    );
  }

  const items = ids.map((id) => (books as Book[]).find((b) => b.id === id)).filter((b): b is Book => Boolean(b));

  return (
    <ListPage title="My picks">
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