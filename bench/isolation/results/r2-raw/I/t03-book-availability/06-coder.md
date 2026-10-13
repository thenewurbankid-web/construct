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
  return (
    <DetailPage title={item.title} back={back}>
      <p>{item.author}</p>
      <p>{item.genre}</p>
      <p>{String(item.year)}</p>
      <p>{String(item.pages)}</p>
      <p>{item.summary}</p>
      {item.available ? (
        <p>On loan</p>
      ) : item.picks.includes(id) ? (
        <p>Already in your picks</p>
      ) : (
        <button>Add to my picks</button>
      )}
    </DetailPage>
  );
}
```