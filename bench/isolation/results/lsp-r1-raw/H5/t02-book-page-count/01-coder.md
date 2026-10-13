```tsx
import Link from 'next/link';
import { DetailPage } from '../../../library/pages/DetailPage';
import books from '../../../library/fixtures/books.json';

export type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; summary: string; available: boolean };

// library/pages/DetailPage.tsx
export type DetailPageProps = {
  title: string;
  /** A link back, shown above the title. */
  back?: ReactNode;
  children?: ReactNode;
  /** Actions beside the content (price, add to cart). */
  aside?: ReactNode;
};

export function DetailPage({ title, back, children, aside }: DetailPageProps) { ... }

export function BookPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const item = (books as Book[]).find((entry) => entry.id === id);
  const back = <Link href="/">Back to Books</Link>;
  if (!item) {
    return <DetailPage title="Book not found" back={back} />;
  }
  return (
    <DetailPage title={item.title} back={back}>
      <h1>{item.title}</h1>
      <p>by {item.author}</p>
      <p>{item.genre}</p>
      <p>{String(item.year)}</p>
      <p>{String(item.pages)} pages</p>
      <p>{item.summary}</p>
      <p>{item.available ? 'Available' : 'Not available'}</p>
    </DetailPage>
  );
}
```