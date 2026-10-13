Add a Genre filter to the catalogue. Use a native `<label htmlFor>` plus `<select>`, passed as `ListPage`'s `toolbar`. The page needs `use client` and React state for the chosen genre. There is no paging yet: list every matching book.

**Instructions:**

1. Import `useState` from `react`.
2. Add a `useState` hook to manage the selected genre.
3. Create a `<select>` element with options for "All genres", "Fiction", "History", and "Science".
4. Use the `selectedGenre` state to filter the books.
5. Pass the `<select>` element as `toolbar` to `ListPage`.

**Code Example:**

```tsx
import { useState } from 'react';
import Link from 'next/link';
import { ListPage } from '../../../library/pages/ListPage';
import books from '../../../library/fixtures/books.json';

type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; available: boolean };

export function BrowsePage() {
  const items = books as Book[];
  const [selectedGenre, setSelectedGenre] = useState<string>('All genres');

  const filteredItems = selectedGenre === 'All genres' ? items : items.filter(item => item.genre === selectedGenre);

  return (
    <ListPage title="Books" toolbar={
      <select value={selectedGenre} onChange={(e) => setSelectedGenre(e.target.value)}>
        <option value="All genres">All genres</option>
        <option value="Fiction">Fiction</option>
        <option value="History">History</option>
        <option value="Science">Science</option>
      </select>
    } empty={<p>No books yet.</p>}>
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