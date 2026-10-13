// @line-level organism
import type { ReactNode } from 'react';
import { ToastProvider } from './Toast';

export type AppLayoutProps = {
  /** Shown above every page, at the left (a logo, a title). */
  header?: ReactNode;
  /** Links shown above every page, at the right (a cart link, the main sections). */
  nav?: ReactNode;
  /** Shown below every page. */
  footer?: ReactNode;
  children: ReactNode;
};

/** The app shell: app/layout.tsx renders it and fills its slots (Line's line.setLayoutSlot writes that file). */
export function AppLayout({ header, nav, footer, children }: AppLayoutProps) {
  return (
    <ToastProvider>
      <div className="mx-auto max-w-5xl p-6">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>{header}</div>
          <nav aria-label="Main" className="flex items-center gap-4">{nav}</nav>
        </div>
        {children}
        <div className="mt-8 text-sm text-slate-600">{footer}</div>
      </div>
    </ToastProvider>
  );
}
