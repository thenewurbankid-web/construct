// @line-level atom
'use client';
import { Slot } from 'radix-ui';
import type { AnchorHTMLAttributes, ReactNode } from 'react';

export type LinkVariant = 'inline' | 'standalone';
const VARIANTS: Record<LinkVariant, string> = {
  inline: 'text-slate-900 underline underline-offset-2 hover:text-slate-600',
  standalone: 'font-medium text-slate-900 no-underline hover:underline',
};

export type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children'> & {
  href: string;
  children: ReactNode;
  /** Points at the current page (aria-current="page"). */
  current?: boolean;
  /** Opens in a new tab, safely, and says so. */
  external?: boolean;
  /** Not navigable: rendered without href, aria-disabled. */
  disabled?: boolean;
  variant?: LinkVariant;
  /** Render the child element (a router link) with the link's look (Radix Slot). */
  asChild?: boolean;
};

/** Navigates somewhere; marks the current page and opens external links safely. */
export function Link({ href, children, current = false, external = false, disabled = false, variant = 'inline', asChild = false, className = '', ...rest }: LinkProps) {
  const Comp = asChild ? Slot.Root : 'a';
  const look = `rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 aria-[current=page]:font-semibold aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:no-underline ${VARIANTS[variant]} ${className}`;
  if (disabled) {
    return <a role="link" aria-disabled="true" data-variant={variant} className={look} {...rest}>{children}</a>;
  }
  return (
    <Comp
      href={asChild ? undefined : href}
      aria-current={current ? 'page' : undefined}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      data-variant={variant}
      className={look}
      {...rest}
    >
      {asChild ? children : (
        <>
          {children}
          {external ? <span data-part="externalIcon"><span aria-hidden="true"> ↗</span><span className="sr-only"> (opens in a new tab)</span></span> : null}
        </>
      )}
    </Comp>
  );
}
