'use client';

import { charge } from '@/lib/billing';

export function Receipt() {
  return <button onClick={() => charge(5)}>Retry</button>;
}
