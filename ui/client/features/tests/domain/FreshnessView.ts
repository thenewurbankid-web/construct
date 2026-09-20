// Pure (DOMAIN-001): what the clone banner draws, derived from the server's comparison (#306).
import type { ComparisonView, FreshnessModel } from '../types.ts';

const WORD = { added: 'New', removed: 'Gone', changed: 'Changed' } as const;

export function freshnessModel(view: ComparisonView): FreshnessModel {
  if (view.status === 'loading') return { kind: 'loading' };
  if (view.status === 'error') return { kind: 'error', message: view.message };
  if (view.status !== 'ready') return { kind: 'none' };
  const d = view.data;
  if (d.state === 'machine-changed') return { kind: 'note', text: d.summary };
  if (d.state !== 'scenario-changed' && d.state !== 'scenario-removed') return { kind: 'none' };
  const gone = d.state === 'scenario-removed';
  return {
    kind: 'stale',
    title: gone ? 'Its scenario is gone' : 'Possibly out of date',
    from: d.from?.scenario || null,
    summary: d.summary,
    caveat: gone ? null : !d.comparable ? 'The steps could not be compared line by line; open the code to see the current flow.' : d.changes.length === 0 ? 'The steps read the same; a condition on the route changed. Open the code to compare.' : null,
    changes: d.changes.map((c) => ({ kind: c.kind, word: WORD[c.kind], text: c.text })),
    next: d.next,
  };
}
