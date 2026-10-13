```tsx
export function PicksPage() {
  const [ids, setIds] = useState<string[]>(() => listPicks());

  const booksMap = new Map<string, Book>(books.map((book) => [book.id, book]));

  const items = ids.filter(id => booksMap.has(id)).map(id => booksMap.get(id));

  return (
    <ListPage title="My picks" empty={<p>No picks yet</p>}>
      {items.length > 0 && items.map((item) => (
        <article key={item.id}>
          <h2>{item.title}</h2>
          <p>{item.author}</p>
          <Button label={`Remove ${item.title}`} onClick={() => removePick(item.id)} />
        </article>
      ))}
    </ListPage>
  );
}
```