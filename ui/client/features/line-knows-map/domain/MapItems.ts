// Pure (DOMAIN-001): the things a person knows to start from (features, pages, components, workflows, the library's
// items), the layer filter, and node ids as named items (for "Who uses this?" and "What breaks if I change it?").
import type { GraphLayer, GraphNode, ItemRef, LayerFilter, LineGraph, StartItem } from '@/lib/lineKnowsContract';

export const LAYER_LABELS: Record<GraphLayer, string> = {
  structure: 'Structure (bases, imports, features)',
  static: 'Calls (what uses what in the code)',
  domain: 'Domain (fields, endpoints, tables)',
  runtime: 'Runtime (seen when the tests ran)',
  process: 'Process (spec points, problems, plan steps)',
};
export const ALL_LAYERS: GraphLayer[] = ['structure', 'static', 'domain', 'runtime', 'process'];

const GROUP: Record<string, StartItem['group']> = { pages: 'page', components: 'component', workflows: 'workflow' };

/** Start points: each feature, then its pages, components and workflows, then the library's items, by name. */
export function startItems(g: LineGraph): StartItem[] {
  const features = g.nodes.filter((n) => n.kind === 'feature').map((n) => ({ id: n.id, name: n.label, text: `Feature ${n.label}`, group: 'feature' as const }));
  const items = g.nodes.filter((n) => n.kind === 'item').map((n): StartItem => {
    const lib = n.attrs?.area === 'library';
    const kind = String(n.attrs?.itemKind ?? '');
    return { id: n.id, name: n.label, text: lib ? `Library ${kind.replace(/s$/, '')}` : `${kind.replace(/s$/, '')} of ${n.attrs?.feature}`, group: lib ? 'library' : (GROUP[kind] ?? 'component') };
  });
  const order: StartItem['group'][] = ['feature', 'page', 'component', 'workflow', 'library'];
  return [...features, ...items].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group) || a.name.localeCompare(b.name));
}

/** The layer checkboxes with how many links each layer has. */
export function layerFilters(g: LineGraph, on: GraphLayer[]): LayerFilter[] {
  return ALL_LAYERS.map((layer) => ({ layer, label: LAYER_LABELS[layer], on: on.includes(layer), count: g.edges.filter((e) => e.layer === layer).length }));
}

/** Flip one layer on or off (at least one stays on). */
export function toggleLayer(on: GraphLayer[], layer: GraphLayer): GraphLayer[] {
  const next = on.includes(layer) ? on.filter((l) => l !== layer) : [...on, layer];
  return next.length ? ALL_LAYERS.filter((l) => next.includes(l)) : on;
}

const describe = (n: GraphNode | undefined, id: string): string => {
  if (!n) return id;
  if (n.kind === 'item') return n.attrs?.area === 'library' ? 'in the library' : `in feature ${n.attrs?.feature}`;
  if (n.kind === 'route') return 'a page address';
  if (n.kind === 'finding') return 'a problem Line found';
  if (n.kind === 'specPoint') return 'a spec point';
  if (n.kind === 'unit') return 'a piece of logic';
  return n.kind;
};

/** Node ids as named items; items first, then pages' addresses, then the rest. */
export function itemRefs(g: LineGraph, ids: string[]): ItemRef[] {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const rank = (id: string) => (id.startsWith('item:') ? 0 : id.startsWith('route:') ? 1 : 2);
  return [...ids].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).map((id) => {
    const n = byId.get(id);
    return { id, name: n?.label ?? id, text: describe(n, id) };
  });
}

/** The sentence over a list of who uses or what breaks. */
export function refsSentence(kind: 'whoUses' | 'breaks', name: string, refs: ItemRef[]): string {
  const items = refs.filter((r) => r.id.startsWith('item:')).length;
  if (kind === 'whoUses') return refs.length ? `${refs.length} item${refs.length === 1 ? '' : 's'} use${refs.length === 1 ? 's' : ''} ${name}.` : `Nothing uses ${name}.`;
  return refs.length ? `Changing ${name} may affect ${refs.length} thing${refs.length === 1 ? '' : 's'}, ${items} of them item${items === 1 ? '' : 's'}.` : `Changing ${name} affects nothing else.`;
}
