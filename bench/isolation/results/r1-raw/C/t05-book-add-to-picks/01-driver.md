Add the "Add to my picks" button to the `BookPage` component. Use the `addPick` function from `features/picks/store/picksStore.ts` and the `Button` component from `library/components/Button.tsx`. The button should be conditionally rendered based on whether the book is available. If the book is available, the button should be enabled and call `addPick` when clicked. If the book is not available, the button should be disabled and display "On loan".

Here's the code to add:

```tsx
// @line-base pages/DetailPage
// @line-route /books/:id
import Link from 'next/link';
import { DetailPage } from '../../../library/pages/DetailPage';
import books from '../../../library/fixtures/books.json';
import { Button } from '../../../library/components/Button';
import { addPick } from '../../../features/picks/store/picksStore';

type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; summary: string; available: boolean };

export function BookPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const item = (books as Book[]).find((entry) => entry.id === id);
  const back = <Link href="/">Back to Books</Link>;
  if (!item) {
    return <DetailPage title="Book not found" back={back} />;
  }

  const handleAddPick = () => {
    if (item.available) {
      addPick(item.id);
      setStatusMessage('Added to your picks');
    }
  };

  const [statusMessage, setStatusMessage] = React.useState('');

  return (
    <DetailPage title={item.title} back={back}>
      <p>{item.author}</p>
      <p>{item.genre}</p>
      <p>{String(item.year)}</p>
      <p>{String(item.pages)}</p>
      <p>{item.summary}</p>
      <p>{String(item.available)}</p>
      {item.available ? (
        <Button label="Add to my picks" onClick={handleAddPick} />
      ) : (
        <Button label="On loan" disabled />
      )}
      {statusMessage && <p>{statusMessage}</p>}
    </DetailPage>
  );
}
```

This code adds the "Add to my picks" button conditionally based on the book's availability. If the book is available, the button is enabled and calls `addPick` when clicked. If the book is not available, the button is disabled and displays "On loan". The status message is displayed below the button if it is set.