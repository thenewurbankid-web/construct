// @line-level atom
'use client';
import { Separator } from 'radix-ui';

export type DividerProps = {
  orientation?: 'horizontal' | 'vertical';
  /** Decorative by default (role="none"); false makes it a semantic separator. */
  decorative?: boolean;
  className?: string;
};

/** A line between groups of content (Radix Separator). */
export function Divider({ orientation = 'horizontal', decorative = true, className = '' }: DividerProps) {
  return (
    <Separator.Root
      orientation={orientation}
      decorative={decorative}
      className={`shrink-0 bg-slate-200 data-[orientation=horizontal]:h-px data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-px ${className}`}
    />
  );
}
