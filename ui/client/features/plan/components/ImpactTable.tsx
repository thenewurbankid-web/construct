import type { ImpactRow } from '../types';
import { ProvenanceBadge } from './ProvenanceBadge';

type Props = { heads: string[]; rows: ImpactRow[]; testId: string; rowTestId: string };

/** A table of impact rows, the last column always the provenance. */
export function ImpactTable({ heads, rows, testId, rowTestId }: Props) {
  return (
    <table className="pl-table" data-testid={testId}>
      <thead>
        <tr>
          {[...heads, 'Provenance'].map((h) => (
            <th key={h}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key} data-testid={rowTestId} data-path={r.path}>
            {r.cells.map((c, i) => (
              <td key={i} className={r.path && i === 0 ? 'pl-mono' : undefined}>
                {c}
              </td>
            ))}
            <td>
              <ProvenanceBadge p={r.provenance} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
