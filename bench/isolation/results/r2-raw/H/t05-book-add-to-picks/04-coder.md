```tsx
import { useState } from 'react';
import Link from 'next/link';
import { DetailPage } from '../../../library/pages/DetailPage';
import books from '../../../library/fixtures/books.json';
import { listPicks, addPick, removePick } from '../../picks/store/picksStore';
import { Button } from '../../../library/components/Button';

export function BookPage({ params }: { params: { id: string } }) {
  const [status, setStatus] = useState('');
  const item = (books as Book[]).find((entry) => entry.id === params.id);
  const back = <Link href="/">Back to Books</Link>;
  if (!item) {
    return <DetailPage title="Book not found" back={back} />;
  }

  const canAddToPicks = item.available || !listPicks().includes(item.id);

  return (
    <DetailPage title={item.title} back={back}>
      <p>{item.author}</p>
      <p>{item.genre}</p>
      <p>{String(item.year)}</p>
      <p>{String(item.pages)}</p>
      <p>{item.summary}</p>
      {canAddToPicks ? (
        <>
          <Button label="Add to my picks" onClick={() => {
            addPick(item.id);
            setStatus('Added to your picks');
          }} />
          {status ? <p role="status">{status}</p> : null}
        </>
      ) : (
        <p>On loan</p>
      )}
    </DetailPage>
  );
}
```