```tsx
import { Button } from '../../../library/components/Button';
import { addPick } from '../../../features/picks/store/picksStore';

export function BookPage({ params }: { params: { id: string } }): ReactNode {
  const { id } = params;
  const item = (books as Book[]).find((entry) => entry.id === id);
  const back = <Link href="/">Back to Books</Link>;
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