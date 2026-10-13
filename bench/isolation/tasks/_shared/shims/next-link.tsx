// Stand-in for next/link in the isolation harness: a plain anchor, same props the pages use.
import type { AnchorHTMLAttributes, ReactNode } from 'react';

export type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { href: string; children?: ReactNode };

export default function Link({ href, children, ...rest }: LinkProps) {
  return <a href={href} {...rest}>{children}</a>;
}
