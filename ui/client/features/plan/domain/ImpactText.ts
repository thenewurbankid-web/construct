// Pure (DOMAIN-001): the sentences of the impact pane.
import type { ImpactFile, ImpactReport } from './PlanTypes.ts';

export const whyText = (f: ImpactFile): string => f.reasons[0]?.message ?? (f.distance === 0 ? 'Contains a seed unit.' : `Reached in ${f.distance} hop(s).`);

export const seedNote = (seeds: { explicit: number; inferred: number }): string => {
  if (seeds.inferred && seeds.explicit) return `${seeds.explicit} unit(s) you picked and ${seeds.inferred} you confirmed from the Notes text`;
  if (seeds.inferred) return `${seeds.inferred} unit(s) you confirmed from the Notes text (guessed, so the result is marked Guess)`;
  return `${seeds.explicit} unit(s) you picked`;
};

export const headline = (r: ImpactReport): string => {
  const feats = r.features.filter((f) => f.kind === 'feature').length;
  return `${feats} feature${feats === 1 ? '' : 's'} · ${r.files.length} file${r.files.length === 1 ? '' : 's'}`;
};
