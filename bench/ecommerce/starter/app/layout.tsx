// @line-layout: the app shell. Line writes this file; change its slots with line.setLayoutSlot.
import type { ReactNode } from 'react';
import './globals.css';
import { AppLayout } from '../library/components/AppLayout';

export const metadata = { title: 'Shop' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AppLayout>{children}</AppLayout>
      </body>
    </html>
  );
}
