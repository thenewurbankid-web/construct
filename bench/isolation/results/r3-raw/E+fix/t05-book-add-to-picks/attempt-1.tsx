// @line-base pages/DetailPage
// @line-route /books/:id
import Link from 'next/link';
import { DetailPage } from '../../../library/pages/DetailPage';
import books from '../../../library/fixtures/books.json';
import React from 'react';
import { Button } from '../../../library/components/Button';
import { addPick } from '../../picks';

type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; summary: string; available: boolean };

export function BookPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const item = (books as Book[]).find((entry) => entry.id === id);
  const back = <Link href="/">Back to Books</Link>;
  if (!item) {
    return <DetailPage title="Book not found" back={back} />;
  }

  const handleAddPick = () => {
    if (item.available) {
      addPick(item.id);
      setStatusMessage('Added to your picks');
    }
  };

  const [statusMessage, setStatusMessage] = React.useState('');

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
      {statusMessage && <p>{statusMessage}</p>}
    </DetailPage>
  );
}
