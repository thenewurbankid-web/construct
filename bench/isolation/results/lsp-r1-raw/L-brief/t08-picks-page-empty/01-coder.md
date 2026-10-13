```tsx
export function PicksPage() {
  const [ids, setIds] = useState<string[]>(() => listPicks());

  if (!ids.length) {
    return <ListPage title="You have not picked any books yet" empty={<p>You have not picked any books yet</p>} />;
  }

  const items = ids.map((id) => (books as Book[]).find((b) => b.id === id)).filter((b): b is Book => Boolean(b));

  return (
    <ListPage title="Picks">
      {items.length > 0 && items.map((item, index) => (
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