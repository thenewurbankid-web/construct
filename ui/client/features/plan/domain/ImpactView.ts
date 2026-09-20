// Pure (DOMAIN-001): the impact report as the strings and rows the pane shows.
import type { ImpactReport } from './PlanTypes.ts';
import type { ImpactView } from '../types.ts';
import { headline, seedNote, whyText } from './ImpactText.ts';

export const buildImpactView = (r: ImpactReport, seeds: { explicit: number; inferred: number }): ImpactView => ({
  headline: headline(r),
  seedNote: seedNote(seeds),
  counts: `${r.stats.derived} derived · ${r.stats.inferred} inferred`,
  warnings: r.warnings.map((w, i) => ({ key: `${w.code}-${i}`, title: w.code === 'SHARED-COMPONENT' ? 'Shared component' : w.code, provenance: w.provenance, message: w.message })),
  features: r.features.map((f) => ({ key: f.name, cells: [f.name, f.layers.map((l) => `${l.layer} (${l.files})`).join(', '), f.why], provenance: f.provenance })),
  files: r.files.map((f) => ({ key: f.path, path: f.path, cells: [f.path, f.layer ?? 'unclassified', whyText(f)], provenance: f.provenance })),
  truncated: !!r.stats.truncated,
});
