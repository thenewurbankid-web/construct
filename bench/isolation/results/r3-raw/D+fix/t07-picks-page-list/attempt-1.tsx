// @line-base pages/ListPage
// @line-route /picks
import { ListPage } from '../../../library/pages/ListPage';
import { Button } from '../../../library/components/Button';
import { listPicks, removePick } from '../store/picksStore';
import books from '../../../library/fixtures/books.json';
import React from 'react';

export function PicksPage() {
  const [picks, setPicks] = React.useState<string[]>(listPicks());

  React.useEffect(() => {
    setPicks(listPicks());
  }, []);

  const handleRemovePick = (id: string) => {
    removePick(id);
    setPicks(listPicks());
  };

  return (
    <ListPage title="Picks">
      {picks.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {picks.map((id) => {
            const book = books.find((b) => b.id === id);
            if (!book) return null;
            return (
              <div key={id} className="flex flex-col gap-2">
                <h2 className="text-lg font-bold">{book.title}</h2>
                <p className="text-gray-600">{book.author}</p>
                <Button onClick={() => handleRemovePick(id)}>Remove {book.title}</Button>
              </div>
            );
          })}
        </div>
      ) : (
        <p>No picks yet.</p>
      )}
    </ListPage>
  );
}
