// @line-level atom
'use client';
import type { ReactNode } from 'react';

export type BadgeVariant = 'neutral' | 'info' | 'success' | 'warning' | 'error';
const VARIANTS: Record<BadgeVariant, string> = {
  neutral: 'bg-slate-100 text-slate-800',
  info: 'bg-blue-100 text-blue-800',
  success: 'bg-green-100 text-green-800',
  warning: 'bg-amber-100 text-amber-900',
  error: 'bg-red-100 text-red-800',
};
const DOTS: Record<BadgeVariant, string> = { neutral: 'bg-slate-500', info: 'bg-blue-600', success: 'bg-green-600', warning: 'bg-amber-500', error: 'bg-red-600' };

export type BadgeProps = { children: ReactNode; variant?: BadgeVariant; dot?: boolean; size?: 'sm' | 'md'; className?: string };

/** A small label for a count or a status; the text carries the meaning, the colour only repeats it. */
export function Badge({ children, variant = 'neutral', dot = false, size = 'md', className = '' }: BadgeProps) {
  return (
    <span data-variant={variant} data-size={size} className={`inline-flex items-center gap-1.5 rounded-full font-medium ${size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-0.5 text-sm'} ${VARIANTS[variant]} ${className}`}>
      {dot ? <span aria-hidden="true" data-part="dot" className={`h-1.5 w-1.5 rounded-full ${DOTS[variant]}`} /> : null}
      {children}
    </span>
  );
}
