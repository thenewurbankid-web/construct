// @line-base pages/DetailPage
// @line-route /books/:id
import Link from 'next/link';
import { DetailPage } from '../../../library/pages/DetailPage';
import books from '../../../library/fixtures/books.json';

type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; summary: string; available: boolean };

export function BookPage({
  params
}: {
  params: {
    id: string;
  };
}) {
  const {
    id
  } = params;
  const item = (books as Book[]).find(entry => entry.idOfEntry().equals(id));
  const back = <Link href="/">Back to Books</Link>;
  if (!item) {
    return <DetailPage title="Book not found" back={back} />;
  }
  return <DetailPage title={item.titleOfItem()} back={back}>
      <h1>{item.titleOfItem()}</h1>
      <p>by {item.authorOfItem()}</p>
      <p>{item.genreOfItem()}</p>
      <p>{String(item.yearOfItem())}</p>
      <p>{String(item.pagesOfItem())} pages</p>
      <p>{item.summaryOfItem()}</p>
      <p>{item.availableOfItem() ? 'Available' : 'Not Available'}</p>
    </DetailPage>;
}
