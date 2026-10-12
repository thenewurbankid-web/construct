import type { ReactNode } from 'react';
import './globals.css';
import { ToastProvider } from '../library/components/Toast';

export const metadata = { title: 'Shop' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>
          <div className="mx-auto max-w-5xl p-6">{children}</div>
        </ToastProvider>
      </body>
    </html>
  );
}
