// Pure (DOMAIN-001): what the graph says about one item, as sentences a person reads ("OrdersPage is based on
// ListPage."). A feature item using an item of another feature is called out: a feature may use only the library.
import type { GraphEdge, GraphLayer, GraphNode, LineGraph, NeighbourSentence } from '@/lib/lineKnowsContract';

type Index = { byId: Map<string, GraphNode>; out: Map<string, GraphEdge[]>; inn: Map<string, GraphEdge[]> };

/** The graph's lookups (built once per graph). */
export function indexGraph(g: LineGraph): Index {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const out = new Map<string, GraphEdge[]>();
  const inn = new Map<string, GraphEdge[]>();
  for (const e of g.edges) {
    out.set(e.from, [...(out.get(e.from) ?? []), e]);
    inn.set(e.to, [...(inn.get(e.to) ?? []), e]);
  }
  return { byId, out, inn };
}

const featureOf = (n: GraphNode | undefined) => (n && typeof n.attrs?.feature === 'string' ? n.attrs.feature : null);
const nameOf = (ix: Index, id: string) => ix.byId.get(id)?.label ?? id.replace(/^[a-z]+:/, '');
const where = (e: GraphEdge) => ('test' in e.evidence ? `seen in test ${e.evidence.test}` : `${e.evidence.file}:${e.evidence.line}`);

/** True when `from` is a feature item that uses an item of another feature. */
export function isCrossFeature(ix: Index, e: GraphEdge): boolean {
  const a = featureOf(ix.byId.get(e.from));
  const b = featureOf(ix.byId.get(e.to));
  return a !== null && b !== null && a !== b && ['IMPORTS', 'RENDERS', 'CALLS', 'USES_HOOK', 'HANDLES_EVENT', 'CALLED_AT_RUNTIME'].includes(e.type);
}

const USE_TYPES = new Set(['IMPORTS', 'RENDERS', 'CALLS', 'USES_HOOK']);

/** One sentence for one edge, read from `from`'s side. Null for an edge a person need not read. */
function sentenceOf(ix: Index, e: GraphEdge): string | null {
  const a = nameOf(ix, e.from);
  const b = nameOf(ix, e.to);
  const to = ix.byId.get(e.to);
  switch (e.type) {
    case 'BASED_ON': return `${a} is based on ${b}.`;
    case 'IMPORTS': case 'RENDERS': case 'CALLS': case 'USES_HOOK': {
      if (isCrossFeature(ix, e)) return `${a} uses ${b} from feature ${featureOf(to)}, which a feature may not do.`;
      return `${a} uses ${b}${to?.attrs?.area === 'library' ? ' from the library' : ''}.`;
    }
    case 'HANDLES_EVENT': return `${a} handles what happens in ${b}.`;
    case 'IN_FEATURE': return `${a} belongs to feature ${b}.`;
    case 'IN_LIBRARY': return `${a} is in the library.`;
    case 'PART_OF': return e.to.startsWith('route:') ? `${a} is shown at ${b}.` : `${a} is a piece of logic in ${b}.`;
    case 'CALLED_AT_RUNTIME': return `${a} used ${b} when the tests ran.`;
    case 'COVERS': return `The spec point "${a}" is about ${b}.`;
    case 'FLAGS': return `Line found a problem with ${b}: ${a}`;
    case 'CHANGES': return `The plan step "${a}" changes ${b}.`;
    case 'READS_FIELD': return `${a} reads ${b}.`;
    case 'WRITES_FIELD': return `${a} writes ${b}.`;
    case 'SERVES': return `${a} is served by ${b}.`;
    case 'MAPS_TO': return `${a} is stored in ${b}.`;
    default: return null;
  }
}

/** The edges a person reads about `id`: its own edges both ways; for a feature, also its items' own edges. */
function edgesAbout(ix: Index, id: string): GraphEdge[] {
  const own = [...(ix.out.get(id) ?? []), ...(ix.inn.get(id) ?? [])];
  const node = ix.byId.get(id);
  if (node?.kind !== 'feature') return own;
  const members = (ix.inn.get(id) ?? []).filter((e) => e.type === 'IN_FEATURE').map((e) => e.from);
  return [...own, ...members.flatMap((m) => [...(ix.out.get(m) ?? []).filter((e) => e.type !== 'IN_FEATURE'), ...(ix.inn.get(m) ?? []).filter((e) => isCrossFeature(ix, e) || e.type === 'FLAGS')])];
}

/**
 * The neighbours of `id` as sentences, for the layers that are on. Several edges between the same two items that say
 * the same thing (an import and a render) are one sentence; its Details list every edge with where it was seen. Rule
 * breaks come first, then by sentence.
 */
export function neighbourSentences(g: LineGraph, id: string, layers: GraphLayer[]): NeighbourSentence[] {
  const ix = indexGraph(g);
  const on = new Set(layers);
  const byText = new Map<string, NeighbourSentence>();
  for (const e of edgesAbout(ix, id)) {
    if (!on.has(e.layer)) continue;
    const text = sentenceOf(ix, e);
    if (!text) continue;
    const other = e.from === id ? e.to : e.to === id ? e.from : e.from;
    const bad = isCrossFeature(ix, e) || e.type === 'FLAGS';
    const line = `${e.from} ${e.type} ${e.to} (${e.layer}, ${where(e)})`;
    const seen = byText.get(text);
    if (seen) { seen.details.push(line); continue; }
    byText.set(text, { id: `${USE_TYPES.has(e.type) ? 'USES' : e.type}:${e.from}>${e.to}`, text, other, layer: e.layer, bad, details: [line] });
  }
  return [...byText.values()].sort((x, y) => Number(y.bad) - Number(x.bad) || x.text.localeCompare(y.text));
}

/** "Line knows 17 items ..." for one item: who it is, in a sentence. */
export function focusText(g: LineGraph, id: string): string {
  const n = indexGraph(g).byId.get(id);
  if (!n) return 'Line does not know this item any more.';
  if (n.kind === 'feature') return `Feature ${n.label}.`;
  if (n.kind === 'library') return 'The library.';
  if (n.kind === 'item') {
    const kind = String(n.attrs?.itemKind ?? 'item').replace(/s$/, '');
    return n.attrs?.area === 'library' ? `A library ${kind}.` : `A ${kind} of feature ${n.attrs?.feature}.`;
  }
  return `A ${n.kind === 'specPoint' ? 'spec point' : n.kind}.`;
}
