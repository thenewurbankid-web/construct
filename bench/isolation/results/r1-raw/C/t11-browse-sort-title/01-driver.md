Change the `items.map` function in `BrowsePage` to sort the books by title in ascending order before rendering them. Use the `Array.prototype.sort` method.

```tsx
{items.length > 0 && items.sort((a, b) => a.title.localeCompare(b.title)).map((item) => (
  <article key={item.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4 shadow-sm">
    <h2 className="text-lg font-semibold"><Link href={`/books/${item.id}`}>{item.title}</Link></h2>
    <p>{item.author}</p>
    <p>{item.genre}</p>
    <p>{String(item.year)}</p>
    <p>{String(item.pages)}</p>
    <p>{String(item.available)}</p>
  </article>
))}
```