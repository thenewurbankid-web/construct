**FUNCTION:** `BookPage`

**SIGNATURE:** 
```tsx
export function BookPage({ params }: { params: { id: string } }): JSX.Element;
```

**IMPORTS:** 
```tsx
import { DetailPage } from '../../../library/pages/DetailPage';
import books from '../../../library/fixtures/books.json';
```

**CHANGE:**
- Change the line that renders the availability to show "On loan" or "Available" instead of `String(item.available)`.
- Add a conditional to disable the "Add to my picks" button if the book is on loan.

**EXAMPLE:**
```tsx
<p>{item.available ? 'Available' : 'On loan'}</p>
```

**ADDITIONAL CHANGE:**
- Add a button to add the book to the user's picks if it is available and not already picked.

**EXAMPLE:**
```tsx
{item.available && !item.picked ? (
  <button disabled={item.picked}>Add to my picks</button>
) : null}
```

**ADDITIONAL EXAMPLE:**
```tsx
type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; summary: string; available: boolean; picked: boolean };
```

**ADDITIONAL EXAMPLE:**
```tsx
const item = (books as Book[]).find((entry) => entry.id === id);
item.picked = item.picked || false; // Initialize picked to false if not already defined
```