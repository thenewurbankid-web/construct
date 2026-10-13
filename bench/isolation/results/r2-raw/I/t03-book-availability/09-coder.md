```tsx
import Link from 'next/link';
import { DetailPage } from '../../../library/pages/DetailPage';
import books from '../../../library/fixtures/books.json';

export type DetailPageProps = {
  title: string;
  /** A link back, shown above the title. */
  back?: ReactNode;
  children?: ReactNode;
  aside?: ReactNode;
};

export function BookPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const item = (books as Book[]).find((entry) => entry.id === id);
  const back = <Link href="/">Back to Books</Link>;
  if (!item) {
    return <DetailPage title="Book not found" back={back} />;
  }
  const isOnLoan = item.available || item.loans.some((loan) => loan.memberId === params.id);
  return (
    <DetailPage title={item.title} back={back}>
      <p>{item.author}</p>
      <p>{item.genre}</p>
      <p>{String(item.year)}</p>
      <p>{String(item.pages)}</p>
      <p>{item.summary}</p>
      {isOnLoan ? (
        <div>
          <h3>On loan</h3>
          <button disabled>Add to my picks</button>
        </div>
      ) : (
        <h3>Available</h3>
      )}
    </DetailPage>
  );
}
```