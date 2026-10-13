'use client';
// @line-base pages/DetailPage
// @line-route /books/:id
import { useState } from 'react';
import Link from 'next/link';
import { Button } from '../../../library/components/Button';
import { addPick } from '../../picks/store/picksStore';
import { DetailPage } from '../../../library/pages/DetailPage';
import { findBook, type Book } from '../services/findBook';

export function BookPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [status, setStatus] = useState('');
  const item = findBook({ id });
  const back = <Link href="/">Back to Books</Link>;
  if (!item) {
    return <DetailPage title="Book not found" back={back} />;
  }
  const aside = item.available ? (
    <>
      <Button label="Add to my picks" onClick={() => { addPick(item.id); setStatus('Added to your picks'); }} />
      {status ? <p role="status">{status}</p> : null}
    </>
  ) : <p>On loan</p>;
  return (
    <DetailPage title={item.title} back={back} aside={aside}>
      <p>{item.author}</p>
      <p>{item.genre}</p>
      <p>{String(item.year)}</p>
      <p>{String(item.pages)}</p>
      <p>{item.summary}</p>
    </DetailPage>
  );
}
