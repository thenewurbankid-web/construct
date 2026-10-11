import type { ReactNode } from 'react';

export function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <table>
      <thead>
        <tr>{head.map((h) => <th key={h}>{h}</th>)}</tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  );
}
