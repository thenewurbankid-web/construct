Change the `DetailPage` call in `BookPage.tsx` to include the page count in the format "312 pages". Here's how:

```tsx
<DetailPage title={item.title} back={back}>
  <p>{item.author}</p>
  <p>{item.genre}</p>
  <p>{String(item.year)}</p>
  <p>{`${item.pages} pages`}</p> {/* Add this line */}
  <p>{item.summary}</p>
  <p>{String(item.available)}</p>
</DetailPage>
```