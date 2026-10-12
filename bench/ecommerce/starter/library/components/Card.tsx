// @line-level molecule
import type { ReactNode } from 'react';

export type CardProps = {
  title: string;
  /** Small text above the title, e.g. a category. */
  eyebrow?: string;
  children?: ReactNode;
  /** Buttons or links at the bottom of the card. */
  footer?: ReactNode;
};

export function Card({ title, eyebrow, children, footer }: CardProps) {
  return (
    <article className="flex flex-col gap-2 rounded-lg border border-slate-200 p-4 shadow-sm">
      {eyebrow ? <p className="text-xs uppercase tracking-wide text-slate-500">{eyebrow}</p> : null}
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
      {footer ? <div className="mt-auto flex gap-2 pt-2">{footer}</div> : null}
    </article>
  );
}
