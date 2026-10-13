import { useState } from 'react';
import { listPicks, removePick } from 'features/picks/store/picksStore';
import { Button } from 'library/components/Button';
import books from 'library/fixtures/books.json';
import { ListPage } from '../../../library/pages/ListPage';

export function PicksPage() {
  const [picks, setPicks] = useState<string[]>(listPicks());

  const handleRemovePick = (id: string) => {
    removePick(id);
    setPicks(listPicks());
  };

  return (
    <ListPage title="Picks">
      {picks.map((id) => {
        const book = books.find((b) => b.id === id);
        if (!book) return null;
        return (
          <div key={id} className="flex items-center justify-between">
            <div>{`${book.title} by ${book.author}`}</div>
            <Button label="Remove" onClick={() => handleRemovePick(id)} />
          </div>
        );
      })}
    </ListPage>
  );
}
