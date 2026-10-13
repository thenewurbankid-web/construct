**FUNCTION:** `BrowsePage`

**SIGNATURE:** `export function BrowsePage(): JSX.Element`

**IMPORTS:** `none`

**CHANGE:**
- Change the `title` prop of `ListPage` to "Library catalogue".
- Change the text of the `available` paragraph to "Available" if `item.available` is `true`, otherwise change it to "On loan".

**EXAMPLE:**
```tsx
<ListPage title="Library catalogue" empty={<p>No books yet.</p>}>
  {items.length > 0 && items.map((item) => (
    <article key={item.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4 shadow-sm">
      <h2 className="text-lg font-semibold"><Link href={`/books/${item.id}`}>{item.title}</Link></h2>
      <p>{item.author}</p>
      <p>{item.genre}</p>
      <p>{String(item.year)}</p>
      <p>{String(item.pages)}</p>
      <p>{item.available ? 'Available' : 'On loan'}</p>
    </article>
  ))}
</ListPage>
```