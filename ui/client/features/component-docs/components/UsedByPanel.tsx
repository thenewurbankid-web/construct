import Link from 'next/link';
import { LoadingState } from '@/features/states';
import type { UsedByResponse } from '../types';

type Props = { usedBy: UsedByResponse | null };

/** #380 "Used by": the pages that reach this component, nearest first, each with the feature it lands in. */
export function UsedByPanel({ usedBy }: Props) {
  if (usedBy === null) return <LoadingState size="inline" label="Finding pages that use this component" />;
  if (!usedBy.ok) return <p className="status-error" role="alert" data-testid="cd-used-by-failed">{usedBy.error ?? "Couldn't read impact for this component."}</p>;
  if (usedBy.pages.length === 0) {
    return (
      <p className="cd-none" data-testid="cd-used-by-none">
        No page in this project reaches this component yet.
      </p>
    );
  }
  return (
    <table className="cd-used-by" data-testid="cd-used-by">
      <thead>
        <tr>
          <th>Page</th>
          <th>Feature</th>
        </tr>
      </thead>
      <tbody>
        {usedBy.pages.map((p) => (
          <tr key={p.path} data-testid="cd-used-by-row" data-path={p.path}>
            <td className="cd-mono">{p.path}</td>
            <td>{p.feature ? <Link href={`/?feature=${encodeURIComponent(p.feature)}`}>{p.feature}</Link> : 'none'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
