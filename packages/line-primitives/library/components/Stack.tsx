// @line-level atom
'use client';
import type { ReactNode } from 'react';

type Gap = '0' | '1' | '2' | '3' | '4' | '6' | '8';
const GAPS: Record<Gap, string> = { 0: 'gap-0', 1: 'gap-1', 2: 'gap-2', 3: 'gap-3', 4: 'gap-4', 6: 'gap-6', 8: 'gap-8' };
const ALIGN = { start: 'items-start', center: 'items-center', end: 'items-end', stretch: 'items-stretch' };
const JUSTIFY = { start: 'justify-start', center: 'justify-center', end: 'justify-end', between: 'justify-between' };

export type StackProps = {
  children: ReactNode;
  direction?: 'column' | 'row';
  gap?: Gap;
  align?: keyof typeof ALIGN;
  justify?: keyof typeof JUSTIFY;
  wrap?: boolean;
  /** Keep semantics: a list or a region when the content is one. */
  as?: 'div' | 'section' | 'ul' | 'ol' | 'nav';
  /** Required when as="section" or "nav", so the region has a name. */
  label?: string;
  className?: string;
};

/** Lays children out in a row or a column with a gap. Adds no roles of its own. */
export function Stack({ children, direction = 'column', gap = '4', align = 'stretch', justify = 'start', wrap = false, as: Tag = 'div', label, className = '' }: StackProps) {
  return (
    <Tag
      aria-label={label}
      data-direction={direction}
      className={`flex ${direction === 'row' ? 'flex-row' : 'flex-col'} ${GAPS[gap]} ${ALIGN[align]} ${JUSTIFY[justify]} ${wrap ? 'flex-wrap' : ''} ${className}`}
    >
      {children}
    </Tag>
  );
}
