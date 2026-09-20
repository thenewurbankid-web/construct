// The counted impact a commit claims, as text. The numbers themselves are computed deterministically
// in core (src/engine/impact.mjs, consumed by src/engine/commitMessage.mjs) and arrive already
// counted — this only renders them, so the screen can never disagree with the commit message.
import type { CommitImpact } from '../types';

/** `2 features, 5 layers, 7 files`, pluralised. */
export function describeImpact(impact: CommitImpact | null | undefined): string {
  if (!impact) return '';
  const p = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  return `${p(impact.features, 'feature')}, ${p(impact.layers, 'layer')}, ${p(impact.files, 'file')}`;
}

/** `checkout: page, controller · billing: domain` — the per-feature layer list, on one line. */
export function describePerFeature(impact: CommitImpact | null | undefined): string {
  if (!impact?.perFeature?.length) return '';
  return impact.perFeature.map((f) => `${f.name}: ${f.layers.join(', ')}`).join(' · ');
}
