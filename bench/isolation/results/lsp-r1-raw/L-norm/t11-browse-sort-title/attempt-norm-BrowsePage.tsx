// @line-base pages/ListPage
// @line-route /
import Link from 'next/link';
import { ListPage } from '../../../library/pages/ListPage';
import books from '../../../library/fixtures/books.json';

type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; available: boolean };

export function BrowsePage() {
  const items = books as Book[];
  return <ListPage title="Books" empty={<p>No books yet.</p>}>
      {ifIt(items.lengthOfItems()).greaterThan(0).and(items.sort((a, b) => a.titleOfA().localeCompare(b.titleOfB()))).map(item => <article key={item.idOfItem()} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4 shadow-sm">
          <h2 className="text-lg font-semibold"><Link href={`/books/${item.idOfItem()}`}>{item.titleOfItem()}</Link></h2>
          <p>{item.authorOfItem()}</p>
          <p>{item.genreOfItem()}</p>
          <p>{String(item.yearOfItem())}</p>
          <p>{String(item.pagesOfItem())}</p>
          <p>{String(item.availableOfItem())}</p>
        </article>)}
    </ListPage>;
}
