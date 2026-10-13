```tsx
import Link from 'next/link';
import { DetailPage } from '../../../library/pages/DetailPage';
import books from '../../../library/fixtures/books.json';
import { useState } from 'react';
import { listPicks, addPick, removePick } from '../../picks/store/picksStore';
import { Button } from '../../../library/components/Button';

type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; summary: string; available: boolean };

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

// features/picks/store/picksStore.ts
export function listPicks(): string[] { ... }

export function addPick(id: string): void { ... }

export function removePick(id: string): void { ... }

// library/components/Button.tsx
export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** The visible text; children win when both are given. */
  label?: string;
  children?: ReactNode;
  variant?: Variant;
  /** Render the child element (a link, say) with the button's look (Radix Slot). */
  asChild?: boolean;
};

export function Button({ label, children, variant = 'primary', asChild = false, className = '', type = 'button', ...rest }: ButtonProps) { ... }

function BookPage({ params }: { params: { id: string } }) {
  const [status, setStatus] = useState('');
  const item = (books as Book[]).find((entry) => entry.id === params.id);
  const back = <Link href="/">Back to Books</Link>;
  if (!item) {
    return <DetailPage title="Book not found" back={back} />;
  }
  const aside = item.available ? (
    <>
      <Button label="Add to my picks" onClick={() => { addToCart(item.id); setStatus('Added to your picks'); }} />
      {status ? <p role="status">{status}</p> : null}
    </>
  ) : (
    <p>On loan</p>
  );
  return <DetailPage title={item.title} back={back} aside={aside}><p>{item.author}</p><p>{item.genre}</p><p>{String(item.year)}</p><p>{String(item.pages)}</p><p>{item.summary}</p></DetailPage>;
}
```