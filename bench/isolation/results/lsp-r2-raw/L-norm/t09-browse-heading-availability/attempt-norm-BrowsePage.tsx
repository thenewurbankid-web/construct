// @line-base pages/ListPage
// @line-route /
import Link from 'next/link';
import { ListPage } from '../../../library/pages/ListPage';
import { listBooks, type Book } from '../services/listBooks';
import { ifIt } from '@smith/core';

export function BrowsePage() {
  const items = listBooks({});
  return <ListPage title="Library catalogue" empty={<p>No books yet.</p>}>
      {ifIt(items.lengthOfItems()).greaterThan(0).and(items).map(item => <article key={item.idOfItem()} className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4 shadow-sm">
          <h2 className="text-lg font-semibold"><Link href={`/books/${item.idOfItem()}`}>{item.titleOfItem()}</Link></h2>
          <p>{item.authorOfItem()}</p>
          <p>{item.genreOfItem()}</p>
          <p>{String(item.yearOfItem())}</p>
          <p>{String(item.pagesOfItem())}</p>
          <p className="text-green-500">{item.availableOfItem() ? 'Available' : 'On loan'}</p>
        </article>)}
    </ListPage>;
}
