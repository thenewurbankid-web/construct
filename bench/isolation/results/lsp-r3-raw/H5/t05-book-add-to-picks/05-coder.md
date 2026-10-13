```tsx
'use client';
import Link from 'next/link';
import { DetailPage } from '../../../library/pages/DetailPage';
import { findBook, type Book } from '../services/findBook';
import { useState } from 'react';
import { listPicks, addPick, removePick } from '../../picks/store/picksStore';
import { Button } from '../../../library/components/Button';

type DetailPageProps = {
  title: string;
  /** A link back, shown above the title. */
  back?: ReactNode;
  children?: ReactNode;
  /** Actions beside the content (price, add to cart). */
  aside?: ReactNode;
};

export function DetailPage({ title, back, children, aside }: DetailPageProps) { ... }

type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; summary: string; available: boolean };

export const findBook = defineService('findBook', ({ id }: { id: string }): Book | undefined => (books as Book[]).find((b) => b.id === id));

type Pick = {
  id: string;
};

function usePicks() {
  const [picks, setPicks] = useState<string[]>([]);
  const listPicks = () => {
    setPicks(listPicks());
  };
  const addPick = (id: string) => {
    if (!picks.includes(id)) {
      setPicks([...picks, id]);
    }
  };
  const removePick = (id: string) => {
    if (picks.includes(id)) {
      setPicks(picks.filter((pick) => pick !== id));
    }
  };
  return { picks, listPicks, addPick, removePick };
}

export function BookPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const item = findBook({ id });
  const back = <Link href="/">Back to Books</Link>;
  if (!item) {
    return <DetailPage title="Book not found" back={back} />;
  }
  const { picks, listPicks, addPick, removePick } = usePicks();
  let aside: ReactNode;
  if (picks.includes(id)) {
    aside = (
      <>
        <Button label="Remove from my picks" onClick={() => removePick(id)} />
      </>
    );
  } else if (!item.available) {
    aside = 'On loan';
  } else {
    aside = (
      <>
        <Button label="Add to my picks" onClick={() => addPick(id)} />
      </>
    );
  }
  return (
    <DetailPage title={item.title} back={back}>
      <p>{item.author}</p>
      <p>{item.genre}</p>
      <p>{String(item.year)}</p>
      <p>{String(item.pages)}</p>
      <p>{item.summary}</p>
      <p role="status">{aside}</p>
    </DetailPage>
  );
}
```