import type { RouteField, TrainChoices } from '../types';

const pick = (key: string, label: string, options: { value: string; label: string }[]): RouteField => ({ key, label, kind: 'pick', options });
const text = (key: string, label: string): RouteField => ({ key, label, kind: 'text', options: [] });

/** The fields of the "Add a route" form for one tool: closed choices from the world, plus a typed name or value. */
export function routeFields(tool: string, c: TrainChoices | null): RouteField[] {
  if (!c) return [];
  const pages = c.items.filter((i) => i.kind === 'pages').map((i) => ({ value: i.file, label: `${i.name} (${i.feature})` }));
  switch (tool) {
    case 'line.baseOn': return [pick('libraryId', 'Library item', c.library.map((l) => ({ value: l.id, label: `${l.name} (${l.kind})` }))), pick('feature', 'Feature', c.features.map((f) => ({ value: f.name, label: f.name }))), text('name', 'New name')];
    case 'line.promote': return [pick('featureItemId', 'Feature item', c.items.map((i) => ({ value: i.id, label: `${i.name} (${i.feature})` })))];
    case 'line.setPageProp': return [pick('file', 'Page', pages), pick('prop', 'Value', [{ value: 'title', label: 'Title' }, { value: 'size', label: 'Page size' }]), text('value', 'New value')];
    case 'line.setFragment': return [pick('file', 'Page', pages), text('said', 'What it should log')];
    case 'line.fix': return [pick('fix', 'Problem and fix', c.findings.flatMap((f) => f.fixes.map((x) => ({ value: `${f.key}\n${x.id}`, label: x.sentence }))))];
    default: return [];
  }
}

/** The tool call's args from the form's values (the first option when a pick was left as it is). */
export function routeArgs(tool: string, values: Record<string, string>, fields: RouteField[]): Record<string, unknown> {
  const v = Object.fromEntries(fields.map((f) => [f.key, values[f.key] ?? (f.kind === 'pick' ? f.options[0]?.value ?? '' : '')]));
  if (tool === 'line.setPageProp') return { file: v.file, nodeId: 'n0', prop: v.prop, kind: v.prop === 'size' ? 'number' : 'string', value: v.prop === 'size' ? Number(v.value) : v.value };
  if (tool === 'line.setFragment') return { file: v.file, fragmentId: 'handler:n0:onMore', said: v.said };
  if (tool === 'line.fix') { const [findingKey, fixId] = String(v.fix).split('\n'); return { findingKey, fixId }; }
  return v;
}
