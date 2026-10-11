import type { ItemGroup, LineFeatureDetail, LineKind, SpecView } from '../types';
import { itemBase, itemLink } from './ItemRows.ts';

const KINDS: { kind: LineKind; title: string }[] = [
  { kind: 'pages', title: 'Pages' },
  { kind: 'components', title: 'Components' },
  { kind: 'workflows', title: 'Workflows' },
  { kind: 'fixtures', title: 'Fixtures' },
];

/** The feature's items by kind, in the order Pages, Components, Workflows, Fixtures; kinds it has none of are left out. */
export function itemGroups(detail: LineFeatureDetail): ItemGroup[] {
  return KINDS.filter(({ kind }) => detail.items[kind].length > 0).map(({ kind, title }) => ({
    kind,
    title,
    rows: detail.items[kind].map((it) => ({ id: it.id, name: it.name, status: it.status, base: itemBase(it), findings: it.findings, link: itemLink(it) })),
  }));
}

/** The spec with one line saying how much of it is covered, or null when the feature has no spec.md. */
export function specView(detail: LineFeatureDetail): SpecView | null {
  if (!detail.spec) return null;
  const points = detail.spec.stories.flatMap((s) => s.points);
  const covered = points.filter((p) => p.covered).length;
  if (points.length === 0) return { file: detail.spec.file, coverage: 'This spec has no acceptance points yet.', stories: detail.spec.stories };
  const noun = points.length === 1 ? 'acceptance point is' : 'acceptance points are';
  return { file: detail.spec.file, coverage: `${covered} of ${points.length} ${noun} covered.`, stories: detail.spec.stories };
}
