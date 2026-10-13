**FUNCTION:** `BookPage`

**SIGNATURE:** 
```tsx
export function BookPage({ params }: { params: { id: string } }): JSX.Element;
```

**IMPORTS:** 
```tsx
import { DetailPage } from '../../../library/pages/DetailPage';
import books from '../../../library/fixtures/books.json';
```

**CHANGE:**
- Remove the `<p>{item.author}</p>` line.
- Add the following line after `<h1 className="text-2xl font-bold">{item.title}</h1>`:
  ```tsx
  <h2 className="text-xl font-semibold">by {item.author}</h2>
  ```

**EXAMPLE:**
```tsx
import Link from 'next/link';
import { DetailPage } from '../../../library/pages/DetailPage';
import books from '../../../library/fixtures/books.json';

type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; summary: string; available: boolean };

export function BookPage({ params }: { params: { id: string } }): JSX.Element {
  const { id } = params;
  const item = (books as Book[]).find((entry) => entry.id === id);
  const back = <Link href="/">Back to Books</Link>;
  if (!item) {
    return <DetailPage title="Book not found" back={back} />;
  }
  return (
    <DetailPage title={item.title} back={back}>
      <h2 className="text-xl font-semibold">by {item.author}</h2>
      <p>{item.genre}</p>
      <p>{String(item.year)}</p>
      <p>{String(item.pages)}</p>
      <p>{item.summary}</p>
      <p>{String(item.available)}</p>
    </DetailPage>
  );
}
```