```tsx
// @line-base pages/ListPage
// @line-route /picks
import { ListPage } from '../../../library/pages/ListPage';
import { Button } from '../../../library/components/Button';
import { listPicks, removePick } from '../store/picksStore';
import { books } from '../../../library/fixtures/books.json';
import type { ReactNode } from 'react';

export function PicksPage() {
  const [picks, setPicks] = React.useState<string[]>(listPicks());

  const handleRemovePick = (id: string) => {
    removePick(id);
    setPicks(listPicks());
  };

  const pickItems = picks.map((id) => {
    const book = books.find((b) => b.id === id);
    if (!book) return null;
    return (
      <div key={id} className="flex items-center justify-between gap-4">
        <div>{book.title}</div>
        <Button label={`Remove ${book.title}`} onClick={() => handleRemovePick(id)} />
      </div>
    );
  });

  return <ListPage title="Picks" children={pickItems} empty={<div>No picks yet.</div>} />;
}
```