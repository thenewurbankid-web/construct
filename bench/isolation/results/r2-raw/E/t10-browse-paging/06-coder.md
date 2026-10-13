```tsx
// @line-base pages/ListPage
// @line-route /
import Link from 'next/link';
import { ListPage } from '../../../library/pages/ListPage';
import books from '../../../library/fixtures/books.json';

type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; available: boolean };

export function BrowsePage() {
  const items = books as Book[];
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.ceil(items.length / 6);
  const startIndex = (currentPage - 1) * 6;
  const endIndex = startIndex + 6;

  const currentPageBooks = items.slice(startIndex, endIndex);

  return (
    <ListPage title="Books" empty={<p>No books yet.</p>}>
      {currentPageBooks.length > 0 && currentPageBooks.map((item) => (
        <article key={item.id} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4 shadow-sm">
          <h2 className="text-lg font-semibold"><Link href={`/books/${item.id}`}>{item.title}</Link></h2>
          <p>{item.author}</p>
          <p>{item.genre}</p>
          <p>{String(item.year)}</p>
          <p>{String(item.pages)}</p>
          <p>{String(item.available)}</p>
        </article>
      ))}
      {totalPages > 1 && (
        <div className="flex justify-center mt-4">
          <Button variant="primary" onClick={() => setCurrentPage(1)} disabled={currentPage === 1}>
            First
          </Button>
          <Button variant="primary" onClick={() => setCurrentPage(currentPage - 1)} disabled={currentPage === 1}>
            Previous
          </Button>
          <Button variant="primary" onClick={() => setCurrentPage(currentPage + 1)} disabled={currentPage === totalPages}>
            Next
          </Button>
          <Button variant="primary" onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages}>
            Last
          </Button>
        </div>
      )}
    </ListPage>
  );
}
```