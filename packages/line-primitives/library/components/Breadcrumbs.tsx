// @line-level molecule
'use client';
import type { MouseEvent } from 'react';

export type Crumb = { label: string; href: string };
export type BreadcrumbsProps = {
  /** The path, root first; the last item is the current page. */
  items: Crumb[];
  /** A crumb was followed (its href); call preventDefault on the event for client-side routing. */
  onNavigate?: (href: string, event: MouseEvent<HTMLAnchorElement>) => void;
};

/** The path to the current page: a nav with an ordered list; the last item is the current page, not a link. */
export function Breadcrumbs({ items, onNavigate }: BreadcrumbsProps) {
  const last = items.length - 1;
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-slate-600">
        {items.map((item, i) => <CrumbItem key={item.href} item={item} current={i === last} first={i === 0} onNavigate={onNavigate} />)}
      </ol>
    </nav>
  );
}

function CrumbItem({ item, current, first, onNavigate }: { item: Crumb; current: boolean; first: boolean; onNavigate?: BreadcrumbsProps['onNavigate'] }) {
  return (
    <li className="flex items-center gap-1.5">
      <Separator show={!first} />
      <CrumbLabel item={item} current={current} onNavigate={onNavigate} />
    </li>
  );
}

function Separator({ show }: { show: boolean }) {
  if (!show) return null;
  return <span aria-hidden="true" data-part="separator">/</span>;
}

function CrumbLabel({ item, current, onNavigate }: { item: Crumb; current: boolean; onNavigate?: BreadcrumbsProps['onNavigate'] }) {
  if (current) return <span aria-current="page" data-part="current" className="font-medium text-slate-900">{item.label}</span>;
  return <a href={item.href} data-part="link" onClick={(e) => onNavigate?.(item.href, e)} className="rounded-sm hover:text-slate-900 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900">{item.label}</a>;
}
