// @line-level atom
'use client';
import type { ReactNode } from 'react';

export type TextElement = 'p' | 'span' | 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6' | 'strong' | 'em' | 'code' | 'kbd' | 'mark' | 'blockquote' | 'q' | 'small';
export type TextSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
export type TextTone = 'default' | 'muted' | 'brand' | 'success' | 'warning' | 'error';

/** The look each element starts with; size and tone override it (theming hook-points). */
const ELEMENT: Record<TextElement, string> = {
  p: 'text-base', span: '', small: 'text-sm',
  h1: 'text-3xl font-bold tracking-tight', h2: 'text-2xl font-semibold', h3: 'text-xl font-semibold', h4: 'text-lg font-semibold', h5: 'text-base font-semibold', h6: 'text-sm font-semibold uppercase tracking-wide',
  strong: 'font-semibold', em: 'italic',
  code: 'rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.9em]', kbd: 'rounded border border-slate-300 bg-slate-50 px-1.5 py-0.5 font-mono text-[0.85em] shadow-sm',
  mark: 'rounded bg-amber-100 px-0.5 text-inherit', blockquote: 'border-l-4 border-slate-300 pl-4 italic', q: 'italic',
};
const SIZES: Record<TextSize, string> = { xs: 'text-xs', sm: 'text-sm', md: 'text-base', lg: 'text-lg', xl: 'text-xl', '2xl': 'text-2xl', '3xl': 'text-3xl' };
const TONES: Record<TextTone, string> = { default: 'text-slate-900', muted: 'text-slate-600', brand: 'text-slate-900', success: 'text-green-700', warning: 'text-amber-800', error: 'text-red-700' };

export type TextProps = {
  children: ReactNode;
  /** The semantic element: headings, paragraphs, inline code, keys, highlights and quotes. */
  as?: TextElement;
  size?: TextSize;
  tone?: TextTone;
  /** Cut to one line with an ellipsis. */
  truncate?: boolean;
  className?: string;
};

/** Text with the right element for its meaning (heading, paragraph, code, key, highlight, quote) and a look from tokens. */
export function Text({ children, as: Tag = 'p', size, tone = 'default', truncate = false, className = '' }: TextProps) {
  const sized = size ? SIZES[size] : '';
  return (
    <Tag data-size={size} data-tone={tone} className={`${ELEMENT[Tag]} ${sized} ${TONES[tone]} ${truncate ? 'truncate' : ''} ${className}`}>
      {children}
    </Tag>
  );
}
