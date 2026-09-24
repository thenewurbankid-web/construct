import type { Provenance } from '../types';

// Plain words for what the engine calls derived and inferred (#391); the data and the class keep the engine's names.
const WORDS: Record<Provenance, string> = { derived: 'Computed', inferred: 'Guess' };

/** Computed (engine: derived): a graph computation from what you picked. Guess (inferred): it depends on a guess. */
export function ProvenanceBadge({ p }: { p: Provenance }) {
  return (
    <span className={`pl-badge pl-badge--${p}`} data-testid="plan-provenance" data-provenance={p}>
      {WORDS[p]}
    </span>
  );
}
