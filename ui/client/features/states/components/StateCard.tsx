import Link from 'next/link';
import type { ReactNode } from 'react';
import type { StateAction } from '../types';

type StateCardProps = {
  tone: 'empty' | 'loading' | 'error' | 'offline';
  role?: 'status' | 'alert';
  size?: 'panel' | 'inline';
  title?: string;
  hint?: string;
  actions?: StateAction[];
  lead?: ReactNode;
  children?: ReactNode;
  testId: string;
};

/** Shared frame of the four designed states (Design #250): icon slot, title,
 * plain-language hint and at most a couple of actions. Presentation only. */
export function StateCard({ tone, role, size = 'panel', title, hint, actions = [], lead, children, testId }: StateCardProps) {
  return (
    <div className={`st st--${tone} st--${size}`} role={role} data-testid={testId}>
      {lead}
      {title && <p className="st-title">{title}</p>}
      {hint && <p className="st-hint">{hint}</p>}
      {children}
      {actions.length > 0 && (
        <div className="st-actions">
          {actions.map((a) => {
            const cls = a.primary ? 'st-btn st-btn--primary' : 'st-btn';
            return a.href ? (
              <Link key={a.label} href={a.href} className={cls}>
                {a.label}
              </Link>
            ) : (
              <button key={a.label} type="button" className={cls} onClick={a.onClick} disabled={a.disabled}>
                {a.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
