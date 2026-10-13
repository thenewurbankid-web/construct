```tsx
export function BrowsePage() {
  const [genre, setGenre] = useState('all');
  const items = books as Book[];
  const filteredItems = genre === 'all' ? items : items.filter((item) => item.genre === genre);
  return (
    <ListPage title="Books" empty={<p>No books yet.</p>}>
      {filteredItems.length > 0 && filteredItems.map((item) => (
        <article key={item.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4 shadow-sm">
          <h2 className="text-lg font-semibold"><Link href={`/books/${item.id}`}>{item.title}</Link></h2>
          <p>{item.author}</p>
          <p>{item.genre}</p>
          <p>{String(item.year)}</p>
          <p>{String(item.pages)}</p>
          <p>{String(item.available)}</p>
        </article>
      ))}
    </ListPage>
  );
}
```