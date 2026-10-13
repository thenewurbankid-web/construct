```tsx
export function BookPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const item = findBook({ id });
  const back = <Link href="/">Back to Books</Link>;
  if (!item) return <DetailPage title="Book not found" back={back} />;
  return (
    <DetailPage title={item.title}>
      <h2>by {item.author}</h2>
      <p>{item.genre}</p>
      <p>{String(item.year)}</p>
      <p>{String(item.pages)} pages</p>
      <p>{item.summary}</p>
      <p>{item.available ? 'Available' : 'Not available'}</p>
    </DetailPage>
  );
}
```