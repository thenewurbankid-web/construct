'use client';
// @line-base pages/DetailPage
// @line-route /books/:id
import Link from 'next/link';
import { DetailPage } from '../../../library/pages/DetailPage';
import { findBook, type Book } from '../services/findBook';
import { Button } from '../../../library/components/Button';
import { listPicks, addPick, removePick } from '../../picks/store/picksStore';
import { useState } from 'react';

export function BookPage({ params }: { params: { id: string } }) {
  const [status, setStatus] = useState('');
  const item = findBook({ id });
  if (!item) {
    return <DetailPage title="Book not found" back={back} />;
  }
  const aside = item.available ? (
    <>
      <Button label="Add to my picks" onClick={() => { addPick(item.id); setStatus('Added to your picks'); }} />
      {status ? <p role="status">{status}</p> : null}
    </>
  ) : (
    <p>On loan</p>
  );
  return <DetailPage title={item.title} aside={aside}><p>{item.author}</p><p>{item.genre}</p><p>{String(item.year)}</p><p>{String(item.pages)}</p><p>{item.summary}</p></DetailPage>;
}
