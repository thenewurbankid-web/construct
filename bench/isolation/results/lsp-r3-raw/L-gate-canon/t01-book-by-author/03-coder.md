```tsx
export function BookPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const item = findBook({ id });
  const back = <Link href="/">Back to Books</Link>;
  if (!item) {
    return <DetailPage title="Book not found" back={back} />;
  }
  return (
    <DetailPage title={item.title} back={back}>
      <h1>{item.title}</h1>
      <p>by {item.author}</p>
      <p>{item.genre}</p>
      <p>{String(item.year)}</p>
      <p>{String(item.pages)} pages</p>
      <p>{item.summary}</p>
      <p>{String(item.available ? 'Available' : 'Not Available')}</p>
    </DetailPage>
  );
}
```