```tsx
// @line-base pages/DetailPage
// @line-route /books/:id
import Link from 'next/link';
import { DetailPage } from '../../../library/pages/DetailPage';
import books from '../../../library/fixtures/books.json';
import { Button } from '../../../library/components/Button';
import { addPick } from '../../../features/picks/store/picksStore';
import { useState } from 'react';

type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; summary: string; available: boolean };

export function BookPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const item = (books as Book[]).find((entry) => entry.id === id);
  const back = <Link href="/">Back to Books</Link>;
  const [status, setStatus] = useState<string | null>(null);

  if (!item) {
    return <DetailPage title="Book not found" back={back} />;
  }

  const handleAddPick = () => {
    /*FILL*/
  };

  return (
    <DetailPage title={item.title} back={back}>
      <p>{item.author}</p>
      <p>{item.genre}</p>
      <p>{String(item.year)}</p>
      <p>{String(item.pages)}</p>
      <p>{item.summary}</p>
      <p>{String(item.available)}</p>
      {item.available ? (
        <Button label="Add to my picks" onClick={handleAddPick} disabled={status === 'Added to your picks'} />
      ) : (
        <p>On loan</p>
      )}
      {status && <p>{status}</p>}
    </DetailPage>
  );
}
```