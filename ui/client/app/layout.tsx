import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { NavBar } from './NavBar';
import './globals.css';

export const metadata: Metadata = {
  title: 'Construct',
  description: 'Local, click-through web UI over Construct’s create/refactor/research/import capabilities.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="app">
        <NavBar />
        <main className="main">{children}</main>
      </body>
    </html>
  );
}
