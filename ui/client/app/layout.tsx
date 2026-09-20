import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AuthGateController, AuthSessionProvider } from '@/features/auth';
import { ShellController, THEME_INIT_SCRIPT } from '@/features/shell';
import './tokens.css';
import './screens.css';
import './shell.css';
import './cockpit-drawer.css';
import './processes.css';
import './globals.css';
import './navigation.css';

export const metadata: Metadata = {
  title: 'Cockpit',
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
        {/* #278: the session is resolved above the shell, so a logged-out
            browser gets a login screen instead of a Cockpit frame whose
            every request would 401. The real enforcement is server-side
            (ui/server/src/auth.mjs); this is the usable half of it. */}
        <AuthSessionProvider>
          <AuthGateController>
            <ShellController>{children}</ShellController>
          </AuthGateController>
        </AuthSessionProvider>
      </body>
    </html>
  );
}
