// @line-level atom
'use client';

export type SpinnerSize = 'sm' | 'md' | 'lg';
const SIZES: Record<SpinnerSize, string> = { sm: 'h-3 w-3 border-2', md: 'h-5 w-5 border-2', lg: 'h-8 w-8 border-[3px]' };

export type SpinnerProps = {
  /** What is loading, for screen readers (visually hidden). */
  label?: string;
  size?: SpinnerSize;
  /** Render only the spinning ring, aria-hidden (inside a button that already says it is busy). */
  decorative?: boolean;
  className?: string;
};

/** Something is loading and no amount is known: role="status" with a visually hidden label. */
export function Spinner({ label = 'Loading', size = 'md', decorative = false, className = '' }: SpinnerProps) {
  const ring = <span aria-hidden="true" className={`inline-block animate-spin rounded-full border-current border-r-transparent motion-reduce:animate-none ${SIZES[size]}`} />;
  if (decorative) return <span data-part="icon" className={`inline-flex ${className}`}>{ring}</span>;
  return (
    <span role="status" data-size={size} className={`inline-flex items-center text-slate-600 ${className}`}>
      {ring}
      <span className="sr-only">{label}</span>
    </span>
  );
}
