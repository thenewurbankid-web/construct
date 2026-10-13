**Instruction:**

1. Import `useState` from React.
2. Import `listPicks` and `removePick` from `features/picks/store/picksStore.ts`.
3. Import `Button` from `library/components/Button.tsx`.
4. Import `books` from `library/fixtures/books.json`.
5. Use `useState` to create a state variable `picks` initialized with the list of picked book IDs from `listPicks()`.
6. Map over the `picks` state to create a list item for each book.
7. For each book, display its title and author.
8. Add a "Remove" button next to each book that calls `removePick(id)` when clicked.
9. Render the list of books in the `ListPage` component.

**Code Example:**

```tsx
import { useState } from 'react';
import { listPicks, removePick } from 'features/picks/store/picksStore';
import { Button } from 'library/components/Button';
import books from 'library/fixtures/books.json';
import { ListPage } from '../../../library/pages/ListPage';

export function PicksPage() {
  const [picks, setPicks] = useState(listPicks());

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
```