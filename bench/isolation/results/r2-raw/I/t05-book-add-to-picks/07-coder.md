```tsx
export function BookPage({ params }: { params: { id: string } }) {
  const [status, setStatus] = useState('');
  const item = (books as Book[]).find((entry) => entry.id === id);
  if (!item) {
    return <DetailPage title="Book not found" back={<Link href="/">Back to Books</Link>} />;
  }
  const aside = item.available ? (
    <>
      <Button label="Add to my picks" onClick={() => { addPick(item.id); setStatus('Added to your picks'); }} />
      {status ? <p role="status">{status}</p> : null}
    </>
  ) : (
    <Button disabled label="On loan" />
  );
  return <DetailPage title={item.title} back={<Link href="/">Back to Books</Link>} aside={aside}>
    <p>{item.author}</p>
    <p>{item.genre}</p>
    <p>{String(item.year)}</p>
    <p>{String(item.pages)}</p>
    <p>{item.summary}</p>
  </DetailPage>;
}
```