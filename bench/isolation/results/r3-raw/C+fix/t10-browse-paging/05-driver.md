Add the page line and buttons below the book list. Ensure the buttons are disabled on the first and last pages.

```tsx
<ListPage title="Books" empty={<p>No books yet.</p>}>
  {items.length > 0 && items.slice((currentPage - 1) * 6, currentPage * 6).map((item) => (
    <article key={item.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4 shadow-sm">
      <h2 className="text-lg font-semibold"><Link href={`/books/${item.id}`}>{item.title}</Link></h2>
      <p>{item.author}</p>
      <p>{item.genre}</p>
      <p>{String(item.year)}</p>
      <p>{String(item.pages)}</p>
      <p>{String(item.available)}</p>
    </article>
  ))}
  <div className="flex justify-between mt-4">
    <Button onClick={handlePreviousPage} variant="ghost" disabled={currentPage === 1}>
      Previous
    </Button>
    <span className="text-slate-700">
      Page {currentPage} of {totalPages}
    </span>
    <Button onClick={handleNextPage} variant="ghost" disabled={currentPage === totalPages}>
      Next
    </Button>
  </div>
</ListPage>
```