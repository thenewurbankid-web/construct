```tsx
import Link from 'next/link';
import { DetailPage } from '../../../library/pages/DetailPage';
import books from '../../../library/fixtures/books.json';

type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; summary: string; available: boolean };

// library/pages/DetailPage.tsx
type DetailPageProps = { title: string; back?: ReactNode; children?: ReactNode; aside?: ReactNode; }
function DetailPage({ title, back, children, aside }: DetailPageProps): React.JSX.Element

export function BookPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const item = (books as Book[]).find((entry) => entry.id === id);
  const back = <Link href="/">Back to Books</Link>;
  if (!item) return <DetailPage title="Book not found" back={back} />;
  return (
    <DetailPage title={item.title} back={back}>
      <p>{item.author}</p>
      <p>{item.genre}</p>
      <p>{String(item.year)}</p>
      <p>{String(item.pages)}</p>
      <p>{item.summary}</p>
      <p>{item.available ? 'On loan' : 'Available'}</p>
    </DetailPage>
  );
}
```