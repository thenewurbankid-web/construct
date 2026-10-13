'use client';
import { Slot } from '@radix-ui/react-slot';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost';
const VARIANTS: Record<Variant, string> = {
  primary: 'bg-slate-900 text-white hover:bg-slate-700',
  secondary: 'border border-slate-300 bg-white text-slate-900 hover:bg-slate-50',
  ghost: 'text-slate-700 hover:bg-slate-100',
};

export type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
  /** The visible text; children win when both are given. */
  label?: string;
  children?: ReactNode;
  variant?: Variant;
  /** Render the child element (a link, say) with the button's look (Radix Slot). */
  asChild?: boolean;
};

export function Button({ label, children, variant = 'primary', asChild = false, className = '', type = 'button', ...rest }: ButtonProps) {
  const Comp = asChild ? Slot : 'button';
  return (
    <Comp type={asChild ? undefined : type} className={`inline-flex items-center justify-center rounded-md px-4 py-2 text-sm font-medium disabled:opacity-50 ${VARIANTS[variant]} ${className}`} {...rest}>
      {children ?? label}
    </Comp>
  );
}
