**FUNCTION:** `BookPage`

**SIGNATURE:** 
```tsx
export function BookPage({ params }: { params: { id: string } }): ReactNode;
```

**IMPORTS:** 
```tsx
import { Button } from '../../../library/components/Button';
import { addPick } from '../../../features/picks/store/picksStore';
```

**CHANGE:**
- Add React state for the status message.
- Add the "Add to my picks" button.
- Handle button click to add the book to picks and update the status message.

**EXAMPLE:**
```tsx
import { Button } from '../../../library/components/Button';
import { addPick } from '../../../features/picks/store/picksStore';

export function BookPage({ params }: { params: { id: string } }): ReactNode {
  const { id } = params;
  const item = (books as Book[]).find((entry) => entry.id === id);
  const back = <Link href="/">Back to Books</Link>;
  const [status, setStatus] = React.useState('');

  if (!item) {
    return <DetailPage title="Book not found" back={back} />;
  }

  const handleAddPick = () => {
    if (item.available) {
      addPick(id);
      setStatus('Added to your picks');
    } else {
      setStatus('On loan');
    }
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
        <Button label="Add to my picks" onClick={handleAddPick} />
      ) : (
        <Button label="On loan" disabled />
      )}
      {status && <p>{status}</p>}
    </DetailPage>
  );
}
```