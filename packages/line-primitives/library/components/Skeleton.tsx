// @line-level atom
'use client';
import type { ReactNode } from 'react';

export type SkeletonProps = {
  /** While true, placeholders show instead of the children. */
  loading?: boolean;
  /** Placeholder lines for shape="text". */
  lines?: number;
  children?: ReactNode;
  shape?: 'text' | 'circle' | 'rect';
};

const SHAPES = { circle: 'h-10 w-10 rounded-full', rect: 'h-24 w-full rounded-md' };

/** A placeholder shaped like the content that is loading; the wrapper is aria-busy and the shapes are aria-hidden. */
export function Skeleton({ loading = true, lines = 3, children, shape = 'text' }: SkeletonProps) {
  if (!loading) return <div data-part="root">{children}</div>;
  return (
    <div data-part="root" aria-busy="true" data-shape={shape} className="flex flex-col gap-2">
      <span className="sr-only">Loading</span>
      <Placeholders shape={shape} lines={lines} />
    </div>
  );
}

function Placeholders({ shape, lines }: { shape: 'text' | 'circle' | 'rect'; lines: number }) {
  if (shape !== 'text') return <span aria-hidden="true" data-part="line" className={`block animate-pulse bg-slate-200 motion-reduce:animate-none ${SHAPES[shape]}`} />;
  const widths = Array.from({ length: lines }, (_, i) => (i === lines - 1 ? 'w-2/3' : 'w-full'));
  return <>{widths.map((w, i) => <span key={i} aria-hidden="true" data-part="line" className={`block h-3 animate-pulse rounded bg-slate-200 motion-reduce:animate-none ${w}`} />)}</>;
}
