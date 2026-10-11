'use client';

import { useState } from 'react';
import { LineComponentPreview } from '@/features/line-render';
import type { LibraryCard } from '../types';

/** The card's detail: the component rendered alone with its props (line-render), drawn only once opened, since each
 * render bundles the component on the server. */
export function CardPreview({ card }: { card: LibraryCard }) {
  const [open, setOpen] = useState(false);
  const summary = <summary>Preview {card.name}</summary>;
  const toggle = (e: { currentTarget: HTMLDetailsElement }) => setOpen(e.currentTarget.open);
  if (!open) {
    return (
      <details className="ll-preview" data-testid="ll-preview" onToggle={toggle}>
        {summary}
      </details>
    );
  }
  return (
    <details className="ll-preview" data-testid="ll-preview" onToggle={toggle} open>
      {summary}
      <LineComponentPreview file={card.file} />
    </details>
  );
}
