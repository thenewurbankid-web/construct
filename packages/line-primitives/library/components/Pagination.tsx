// @line-level molecule
'use client';

export type PaginationProps = {
  /** The current page, from 1. */
  page: number;
  pageCount: number;
  onPageChange?: (page: number) => void;
  /** Pages shown on each side of the current one before an ellipsis. */
  siblings?: number;
  size?: 'sm' | 'md';
};

/** The page numbers to show: first, last, the current one with its siblings, and 'gap' for each ellipsis. */
export function pageItems(page: number, pageCount: number, siblings = 1): (number | 'gap')[] {
  const wanted = new Set([1, pageCount]);
  for (let p = page - siblings; p <= page + siblings; p += 1) if (p >= 1 && p <= pageCount) wanted.add(p);
  const sorted = [...wanted].sort((a, b) => a - b);
  const out: (number | 'gap')[] = [];
  sorted.forEach((p, i) => { if (i > 0 && p - sorted[i - 1] > 1) out.push('gap'); out.push(p); });
  return out;
}

const BUTTON = 'inline-flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-sm text-slate-900 hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900 disabled:cursor-not-allowed disabled:opacity-40 aria-[current=page]:bg-slate-900 aria-[current=page]:text-white';

/** Move between pages of results: a nav of page buttons with previous and next; the current page has aria-current. */
export function Pagination({ page, pageCount, onPageChange, siblings = 1, size = 'md' }: PaginationProps) {
  const go = (p: number) => { if (p !== page && p >= 1 && p <= pageCount) onPageChange?.(p); };
  return (
    <nav aria-label="Pagination" data-size={size}>
      <ul className="flex items-center gap-1">
        <li><button type="button" data-part="previous" className={BUTTON} disabled={page <= 1} onClick={() => go(page - 1)}>Previous</button></li>
        {pageItems(page, pageCount, siblings).map((item, i) => <PageItem key={`${item}-${i}`} item={item} current={item === page} onGo={go} />)}
        <li><button type="button" data-part="next" className={BUTTON} disabled={page >= pageCount} onClick={() => go(page + 1)}>Next</button></li>
      </ul>
    </nav>
  );
}

function PageItem({ item, current, onGo }: { item: number | 'gap'; current: boolean; onGo: (p: number) => void }) {
  if (item === 'gap') return <li aria-hidden="true" data-part="ellipsis" className="px-1 text-slate-500">…</li>;
  return (
    <li>
      <button type="button" data-part="page" aria-label={`Page ${item}`} aria-current={current ? 'page' : undefined} className={BUTTON} onClick={() => onGo(item)}>{item}</button>
    </li>
  );
}
