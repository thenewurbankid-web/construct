```tsx
export function BookPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const item = (books as Book[]).find((entry) => entry.id === id);
  const back = <Link href="/">Back to Books</Link>;
  if (!item) {
    return <DetailPage title="Book not found" back={back} />;
  }

  const [status, setStatus] = useState('');
  let aside;

  if (item.available) {
    aside = (
      <>
        <Button label="Add to my picks" onClick={() => addPick(id)} />
        {status ? <p role="status">{status}</p> : null}
      </>
    );
  } else {
    aside = 'On loan';
  }

  return (
    <DetailPage title={item.title} back={back}>
      <p>{item.author}</p>
      <p>{item.genre}</p>
      <p>{String(item.year)}</p>
      <p>{String(item.pages)}</p>
      <p>{item.summary}</p>
      <p role="status">{aside}</p>
    </DetailPage>
  );
}
```