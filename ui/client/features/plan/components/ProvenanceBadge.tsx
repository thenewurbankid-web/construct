import type { Provenance } from '../types';

/** derived: a graph computation from what you picked. inferred: it depends on a guess. */
export function ProvenanceBadge({ p }: { p: Provenance }) {
  return (
    <span className={`pl-badge pl-badge--${p}`} data-testid="plan-provenance">
      {p}
    </span>
  );
}
