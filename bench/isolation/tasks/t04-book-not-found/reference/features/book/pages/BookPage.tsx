// @line-base pages/DetailPage
// @line-route /books/:id
import Link from 'next/link';
import { DetailPage } from '../../../library/pages/DetailPage';
import { findBook, type Book } from '../services/findBook';

export function BookPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const item = findBook({ id });
  const back = <Link href="/">Back to the catalogue</Link>;
  if (!item) {
    return <DetailPage title="We could not find that book" back={back} />;
  }
  return (
    <DetailPage title={item.title} back={back}>
      <p>{item.author}</p>
      <p>{item.genre}</p>
      <p>{String(item.year)}</p>
      <p>{String(item.pages)}</p>
      <p>{item.summary}</p>
      <p>{String(item.available)}</p>
    </DetailPage>
  );
}
