import Link from 'next/link';
import type { ItemRow } from '../types';
import { FindingList } from './FindingList';

/** The item's name: a link to the screen that edits it (pages, components), plain text for the other kinds. */
function ItemName({ row }: { row: ItemRow }) {
  if (!row.link) return <span className="lf-item-name">{row.name}</span>;
  return (
    <Link href={row.link.href} className="lf-item-name" aria-label={row.link.label} data-testid="lf-item-link">
      {row.name}
    </Link>
  );
}

/** One item: its name, its library base, its status and, when it needs attention, each finding as a sentence. `open`
 * (two modes): the item the chat or a breadcrumb opened, with its open part. */
export function ItemRowView({ row, open = false, part = null }: { row: ItemRow; open?: boolean; part?: string | null }) {
  return (
    <li className="lf-item" data-testid="lf-item" data-item={row.name} data-open={open || undefined} aria-current={open ? 'true' : undefined}>
      <div className="lf-item-head">
        <ItemName row={row} />
        <span className={`lf-chip lf-chip--${row.status}`} data-testid="lf-item-status">
          {row.status === 'ok' ? 'Fine' : 'Needs attention'}
        </span>
      </div>
      <p className={`lf-base${row.base.ok ? '' : ' lf-base--problem'}`} data-testid="lf-item-base">
        {row.base.text}
      </p>
      {part ? (
        <p className="lf-open-part" data-testid="lf-open-part">
          Open part: {part}
        </p>
      ) : null}
      <FindingList name={row.name} findings={row.findings} />
    </li>
  );
}
