// @line-base pages/ListPage
// @line-route /picks
import { ListPage } from '../../../library/pages/ListPage';
import { useState, useEffect } from 'react';
import { books } from '../../../library/fixtures/books.json';
import { listPicks, removePick } from '../../../features/picks/store/picksStore';
import { Button } from '../../../library/components/Button';

export function PicksPage() {
  const [pickedBooks, setPickedBooks] = useState<string[]>(listPicks());

  useEffect(() => {
    setPickedBooks(listPicks());
  }, []);

  const handleRemovePick = (id: string) => {
    removePick(id);
    setPickedBooks(listPicks());
  };

  return (
    <ListPage title="Picks">
      {pickedBooks.length > 0 ? (
        pickedBooks.map((id) => {
          const book = books.find((b) => b.id === id);
          if (book) {
            return (
              <div key={id} className="flex items-center justify-between gap-4">
                <div>{book.title} by {book.author}</div>
                <Button onClick={() => handleRemovePick(id)}>Remove {book.title}</Button>
              </div>
            );
          }
          return null;
        })
      ) : (
        <div>No picks yet.</div>
      )}
    </ListPage>
  );
}
