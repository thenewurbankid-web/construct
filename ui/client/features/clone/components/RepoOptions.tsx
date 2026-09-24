'use client';

import type { RepoOption } from '../types';

/** Presentation-only: the <option> entries of the repository picker. */
export function RepoOptions({ options }: { options: RepoOption[] }) {
  return (
    <>
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </>
  );
}
