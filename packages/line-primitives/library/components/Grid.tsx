// @line-level atom
'use client';
import type { ReactNode } from 'react';

type Columns = '1' | '2' | '3' | '4' | '6' | '12';
/** One column on phones, the asked-for count from the md breakpoint up. */
const COLUMNS: Record<Columns, string> = { 1: 'grid-cols-1', 2: 'grid-cols-1 md:grid-cols-2', 3: 'grid-cols-1 md:grid-cols-3', 4: 'grid-cols-2 md:grid-cols-4', 6: 'grid-cols-2 md:grid-cols-6', 12: 'grid-cols-4 md:grid-cols-12' };
type Gap = '0' | '2' | '4' | '6' | '8';
const GAPS: Record<Gap, string> = { 0: 'gap-0', 2: 'gap-2', 4: 'gap-4', 6: 'gap-6', 8: 'gap-8' };

export type GridProps = {
  children: ReactNode;
  columns?: Columns;
  gap?: Gap;
  as?: 'div' | 'ul' | 'section';
  label?: string;
  className?: string;
};

/** Lays children out in responsive columns. Adds no roles of its own. */
export function Grid({ children, columns = '3', gap = '4', as: Tag = 'div', label, className = '' }: GridProps) {
  return <Tag aria-label={label} data-columns={columns} className={`grid ${COLUMNS[columns]} ${GAPS[gap]} ${className}`}>{children}</Tag>;
}
