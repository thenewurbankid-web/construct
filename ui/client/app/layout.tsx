import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ShellController, THEME_INIT_SCRIPT } from '@/features/shell';
import './tokens.css';
import './screens.css';
import './shell.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'Construct',
  description: 'Local, click-through web UI over Construct’s create/refactor/research/import capabilities.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before first paint (no flash); dark by default. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="app">
        <ShellController>{children}</ShellController>
      </body>
    </html>
  );
}
