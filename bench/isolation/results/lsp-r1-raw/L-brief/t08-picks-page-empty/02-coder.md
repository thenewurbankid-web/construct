```tsx
import { ListPage } from '../../../library/pages/ListPage';
import { useState } from 'react';
import { listPicks, addPick, removePick } from '../store/picksStore';
import books from '../../../library/fixtures/books.json';

function listPicks(): string[] {
  return books.map((book) => book.id);
}

function addPick(id: string): void {
  // Implementation not provided
}

function removePick(id: string): void {
  // Implementation not provided
}

export function PicksPage() {
  const [ids, setIds] = useState<string[]>(() => listPicks());

  return (
    <ListPage title="My picks" empty={<p>You have not picked any books yet</p>}>
      {ids.length > 0 && ids.map((id) => (
        <article key={id}>
          <h2>{books.find((book) => book.id === id)?.title}</h2>
          {/* Add other fields */}
          <Button label={`Remove ${books.find((book) => book.id === id)?.title}`} onClick={() => { removePick(id); setIds(listPicks()); }} />
        </article>
      ))}
    </ListPage>
  );
}
```