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
  const backLinkText = 'Back to the catalogue';
  const titleMessage = 'We could not find that book';
  if (!item) {
    return <DetailPage title={titleMessage} back={<Link href="/">Back to Books</Link>} />;
  }
  return (
    <DetailPage title={title} back={<Link href="/">Back to Books</Link>}>
      <p>{item.author}</p>
      <p>{item.genre}</p>
      <p>{String(item.year)}</p>
      <p>{String(item.pages)}</p>
      <p>{item.summary}</p>
      <p>{String(item.available)}</p>
    </DetailPage>
  );
}
```