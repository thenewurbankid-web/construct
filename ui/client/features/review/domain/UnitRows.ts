// Pure (DOMAIN-001): the stage's "what each changed unit now does" rows. The sentences come from the
// engine's `summarizeUnit` (deterministic, read from the code on the head commit); this only joins them to
// the changed files and folds the ones with nothing to say into one "+N more" row.
import type { ChangedFile, UnitSummary, UnitsView } from '../types.ts';
import { UNCLASSIFIED_LAYER } from './LayerOrder.ts';
import { fileName } from './TreeFiles.ts';

/** The sentence without the repeated "File <path>:" lead-in the engine puts on every summary. */
export function trimLead(summary: string, path: string): string {
  const lead = `File ${path}: `;
  return summary.startsWith(lead) ? summary.slice(lead.length) : summary;
}

/** Units with a sentence first, in the order of the tree (feature, then path); the rest collapse. */
export function buildUnitsView(files: ChangedFile[], summaries: UnitSummary[], omitted = 0): UnitsView {
  const byPath = new Map(summaries.map((s) => [s.path, s]));
  const rows: UnitsView['rows'] = [];
  let quiet = 0;
  const ordered = [...files].sort((a, b) => (a.feature ?? '￿').localeCompare(b.feature ?? '￿') || a.path.localeCompare(b.path));
  for (const f of ordered) {
    const s = byPath.get(f.path);
    if (!s?.summary) { quiet += 1; continue; }
    rows.push({ path: f.path, name: fileName(f.path), layer: f.layer ?? UNCLASSIFIED_LAYER, feature: f.feature ?? 'outside features', isNew: f.status === 'A', text: trimLead(s.summary, f.path) });
  }
  const count = quiet + omitted;
  return { rows, more: count > 0 ? { count, text: `${count} more file${count === 1 ? '' : 's'} (deleted, configuration, tests or nothing to summarise).` } : null };
}
