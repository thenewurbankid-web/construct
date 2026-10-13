**FUNCTION:** `PicksPage`

**SIGNATURE:** 
```tsx
export function PicksPage(): JSX.Element;
```

**IMPORTS:** 
```tsx
import { ListPage } from '../../../library/pages/ListPage';
import { Button } from '../../../library/components/Button';
import { listPicks, removePick } from '../../../features/picks/store/picksStore';
import { books } from '../../../library/fixtures/books.json';
import { useState, useEffect } from 'react';
```

**CHANGE:**
- Add React state to store the list of picked books.
- Fetch the picked book ids from the store.
- Map over the picked book ids to look up the book details in the `books` fixture.
- Render each book with its title, author, and a "Remove" button.
- Add a function to handle the removal of a book and update the state.

**EXAMPLE:**
```tsx
import { ListPage } from '../../../library/pages/ListPage';
import { Button } from '../../../library/components/Button';
import { listPicks, removePick } from '../../../features/picks/store/picksStore';
import { books } from '../../../library/fixtures/books.json';
import { useState, useEffect } from 'react';

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
```