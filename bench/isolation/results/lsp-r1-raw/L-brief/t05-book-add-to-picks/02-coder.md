```tsx
import Link from 'next/link';
import { DetailPage } from '../../../library/pages/DetailPage';
import books from '../../../library/fixtures/books.json';
import { useState } from 'react';
import { listPicks, addPick, removePick } from '../../picks/store/picksStore';
import { Button } from '../../../library/components/Button';

type Book = { id: string; title: string; author: string; genre: string; year: number; pages: number; summary: string; available: boolean };

// features/picks/store/picksStore.ts
function listPicks(): string[]
function addPick(id: string): void
function removePick(id: string): void

// library/components/Button.tsx
type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> & { label?: string; children?: ReactNode; variant?: Variant; asChild?: boolean; }
function Button({ label, children, variant, asChild, className, type, ...rest }: ButtonProps): React.JSX.Element

// library/pages/DetailPage.tsx
type DetailPageProps = { title: string; back?: ReactNode; children?: ReactNode; aside?: ReactNode; }
function DetailPage({ title, back, children, aside }: DetailPageProps): React.JSX.Element

export function BookPage({ params }: { params: { id: string } }) {
  const [status, setStatus] = useState('');
  const item = (books as Book[]).find((entry) => entry.id === id);
  if (!item) {
    return <DetailPage title="Book not found" back={back} />;
  }
  const aside = item.available ? (
    <>
      <Button label="Add to my picks" onClick={() => { addPick(item.id); setStatus('Added to your picks'); }} />
      {status ? <p role="status">{status}</p> : null}
    </>
  ) : <p>On loan</p>;
  return <DetailPage title={item.title} back={back} aside={aside}><p>{item.author}</p></DetailPage>;
}
```