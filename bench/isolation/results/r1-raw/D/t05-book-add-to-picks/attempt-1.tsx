// @line-base pages/DetailPage
// @line-route /books/:id
import Link from 'next/link';
import { DetailPage } from '../../../library/pages/DetailPage';
import { Button } from '../../../library/components/Button';
import books from '../../../library/fixtures/books.json';
import { addPick } from '../../../features/picks/store/picksStore';

type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; summary: string; available: boolean };

export function BookPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const item = (books as Book[]).find((entry) => entry.id === id);
  const back = <Link href="/">Back to Books</Link>;
  const [status, setStatus] = React.useState<string | null>(null);

  if (!item) {
    return <DetailPage title="Book not found" back={back} />;
  }

  const handleAddPick = () => {
    if (item.available) {
      addPick(item.id);
      setStatus('Added to your picks');
    } else {
      setStatus('On loan');
    }
  };

  return (
    <DetailPage title={item.title} back={back}>
      <p>{item.author}</p>
      <p>{item.genre}</p>
      <p>{String(item.year)}</p>
      <p>{String(item.pages)}</p>
      <p>{item.summary}</p>
      <p>{String(item.available)}</p>
      {item.available ? (
        <Button label="Add to my picks" onClick={handleAddPick} />
      ) : (
        <Button label="On loan" disabled />
      )}
      {status && <p className="mt-2 text-sm">{status}</p>}
    </DetailPage>
  );
}
