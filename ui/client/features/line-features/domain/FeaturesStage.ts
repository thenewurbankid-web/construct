// Two modes, live stage: what Features knows about each level of the place (feature, item, part): the kind, the status
// and the base, from the project as read. Pure; tested by FeaturesModes.spec.mjs.
import type { LineProject, Place, StagePart } from '../types';

const KIND: Record<string, StagePart['kind']> = { pages: 'page', components: 'component', workflows: 'workflow', fixtures: 'component' };

export function featuresStageParts(place: Place, project: LineProject): StagePart[] {
  const [feature, item, part] = place.steps.map((s) => s.id);
  const f = project.features.find((x) => x.name === feature);
  if (!f) return [];
  const bad = f.items.some((i) => i.status === 'problem');
  const out: StagePart[] = [{ param: 'feature', id: f.name, kind: 'feature', status: bad ? 'gap' : 'fit', statusLabel: bad ? 'Needs attention' : 'All fine' }];
  const it = f.items.find((i) => i.name === item);
  if (it) out.push({ param: 'item', id: it.name, kind: KIND[it.kind] ?? 'component', status: it.status === 'ok' ? 'fit' : 'gap', statusLabel: it.status === 'ok' ? 'Fine' : 'Needs attention', base: it.base.value?.split('/').pop() ?? null, findings: it.findings.map((x) => x.sentence) });
  if (it && part) out.push({ param: 'part', id: part, kind: 'component', status: 'open', statusLabel: `A value of ${it.name}` });
  return out;
}
