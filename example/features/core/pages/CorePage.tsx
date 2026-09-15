import type { ReactNode } from 'react';
import Link from 'next/link';
import { Core } from '../components/Core';

export function CorePage(): ReactNode {
  return (
    <main>
      <Core />
      <p>
        <Link href="/login">Log in</Link>
      </p>
    </main>
  );
}
