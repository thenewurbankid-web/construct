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

  const handlePreviousPage = () => {
    if (currentPage > 1) {
      setCurrentPage(currentPage - 1);
    }
  };

  const handleNextPage = () => {
    if (currentPage < totalPages) {
      setCurrentPage(currentPage + 1);
    }
  };

  return (
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
        <button disabled={currentPage === 1} onClick={handlePreviousPage} className="px-4 py-2 text-sm font-medium rounded-md bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50">
          Previous page
        </button>
        <p className="text-sm font-medium">Page {currentPage} of {totalPages}</p>
        <button disabled={currentPage === totalPages} onClick={handleNextPage} className="px-4 py-2 text-sm font-medium rounded-md bg-slate-900 text-white hover:bg-slate-700 disabled:opacity-50">
          Next page
        </button>
      </div>
    </ListPage>
  );
}
