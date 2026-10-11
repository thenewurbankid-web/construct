// Delexicalized structure of a Line project and its hashes: the ONE structure module (expressions' facts, plan records
// and the System 1 drafter all use it). Steps are transitions between structure states. A hash covers what the
// project IS, never what things are CALLED, so a rename changes nothing and adding a page changes its feature's hash,
// the hash of that feature's ui layer and the project's.
//
//   graph     nodes = library and feature items {id, area, feature, kind, layer}; edges = base links and import edges
//             (relative imports between items, read from the source)
//   roles     derived from the graph only: a library component is an atom (imports no library component), a molecule
//             (imports atoms only) or an organism; library pages are "page", workflows "flow", fixtures "data"; a
//             feature item takes "on:<role of its base>" or "unbased"
//   hashes    "sha256:<16 hex>" over sorted signatures (area:kind:role, and edges as type:sig>relation:sig where
//             relation is same / library / other feature), at project, library, feature and layer level (layers:
//             ui = pages and components, workflow, data = fixtures)
//   delta     closed ops (drafter/contract.mjs DELTA_OPS) applied in memory give a route's predicted hashes;
//             verification hashes the scratch copy after the change and compares. `structureDelta` is the record form
//             (slotted item lines) that plan records store.
// Gap: flow states and transitions inside a workflow are not modelled yet (a workflow is one node); cw1 adds them.
// (Merged 2026-10-11 from the expressions branch's structure.mjs and the drafter's canonical hash; the drafter's own
// copy is gone.)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

/**
 * "sha256:<16 hex>" of a canonical JSON value.
 * @param {unknown} v
 * @returns {string}
 */
export const hash16 = (v) => `sha256:${crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16)}`;

/** Line kind -> layer. The library layer holds every kind; api has no kind yet. */
export const KIND_LAYER = Object.freeze({ pages: 'ui', components: 'ui', workflows: 'workflow', fixtures: 'data', usecases: 'workflow', services: 'data', domains: 'data' });
/** The layers a feature's hashes are given for. */
export const FEATURE_LAYERS = Object.freeze(['ui', 'workflow', 'data']);

const posix = path.posix;
const SPEC = /(?:\bfrom\s+|\bimport\s*\(\s*|^\s*import\s+)(['"])([^'"\n]+)\1/gm;
const stripExt = (rel) => rel.replace(/\.[cm]?[jt]sx?$|\.json$/, '');

/**
 * @typedef {{id: string, area: 'feature'|'library', feature: string|null, kind: string, layer: string, file: string}} SNode
 * @typedef {{from: string, to: string, type: 'base'|'import'}} SEdge
 * @typedef {{nodes: Map<string, SNode>, edges: SEdge[]}} SGraph
 * @typedef {(rel: string) => string} SourceReader  Root-relative posix path -> its text ('' when it cannot be read).
 */

/**
 * A reader of a project's source files on disk.
 * @param {string} root
 * @returns {SourceReader}
 */
export const readerOf = (root) => (rel) => { try { return fs.readFileSync(path.join(root, rel), 'utf8'); } catch { return ''; } };

/**
 * The structure graph of a project (readLineProject's view); import edges come from the sources `read` returns.
 * @param {any} project
 * @param {SourceReader} [read]  Without one, the graph has base edges only.
 * @returns {SGraph}
 */
export function structureGraph(project, read = () => '') {
  /** @type {Map<string, SNode>} */
  const nodes = new Map();
  for (const l of project.library ?? []) nodes.set(l.id, { id: l.id, area: 'library', feature: null, kind: l.kind, layer: KIND_LAYER[l.kind], file: l.file });
  for (const f of project.features ?? []) for (const i of f.items ?? []) nodes.set(i.id, { id: i.id, area: 'feature', feature: f.name, kind: i.kind, layer: KIND_LAYER[i.kind], file: i.file });
  const byStem = new Map([...nodes.values()].map((n) => [stripExt(n.file), n.id]));
  /** @type {SEdge[]} */
  const edges = [];
  for (const f of project.features ?? []) for (const i of f.items ?? []) { const b = i.base?.libraryId; if (b && nodes.has(b)) edges.push({ from: i.id, to: b, type: 'base' }); }
  for (const n of nodes.values()) {
    if (n.kind === 'fixtures') continue;
    const src = read(n.file);
    if (!src) continue;
    const seen = new Set();
    for (const m of src.matchAll(SPEC)) {
      const spec = m[2];
      if (!spec.startsWith('.')) continue;
      const target = posix.normalize(posix.join(posix.dirname(n.file), spec));
      const to = byStem.get(stripExt(target)) ?? byStem.get(`${target}/index`);
      if (to && to !== n.id && !seen.has(to)) { seen.add(to); edges.push({ from: n.id, to, type: 'import' }); }
    }
  }
  return { nodes, edges };
}

/**
 * Roles from the graph alone (see the header).
 * @param {SGraph} g
 * @returns {Map<string, string>}
 */
export function rolesOf(g) {
  const roles = new Map();
  const libComp = (id) => g.nodes.get(id)?.area === 'library' && g.nodes.get(id)?.kind === 'components';
  const deps = new Map();
  for (const e of g.edges) if (e.type === 'import' && libComp(e.from) && libComp(e.to)) { if (!deps.has(e.from)) deps.set(e.from, []); deps.get(e.from).push(e.to); }
  const level = (id, stack = new Set()) => {
    const d = deps.get(id) ?? [];
    if (!d.length) return 'atom';
    if (stack.has(id)) return 'organism';
    stack.add(id);
    const all = d.map((x) => level(x, stack));
    stack.delete(id);
    return all.every((x) => x === 'atom') ? 'molecule' : 'organism';
  };
  const libRole = (n) => (n.kind === 'components' ? level(n.id) : n.kind === 'pages' ? 'page' : n.kind === 'workflows' ? 'flow' : 'data');
  for (const n of g.nodes.values()) if (n.area === 'library') roles.set(n.id, libRole(n));
  for (const n of g.nodes.values()) {
    if (n.area !== 'feature') continue;
    const b = g.edges.find((e) => e.type === 'base' && e.from === n.id);
    roles.set(n.id, b && roles.has(b.to) ? `on:${roles.get(b.to)}` : 'unbased');
  }
  return roles;
}

/** The hash of every part of a graph: library, each feature, each feature layer, the project. */
function hashParts(g) {
  const roles = rolesOf(g);
  const sig = (id) => { const n = g.nodes.get(id); return `${n.area}:${n.kind}:${roles.get(id)}`; };
  const rel = (a, b) => { const x = g.nodes.get(a); const y = g.nodes.get(b); return y.area === 'library' ? 'library' : x.feature === y.feature ? 'same' : 'other'; };
  const edgeSig = (e) => `${e.type}:${sig(e.from)}>${rel(e.from, e.to)}:${sig(e.to)}`;
  const part = (pred) => {
    const ids = [...g.nodes.values()].filter(pred).map((n) => n.id);
    const set = new Set(ids);
    return hash16({ n: ids.map(sig).sort(), e: g.edges.filter((e) => set.has(e.from)).map(edgeSig).sort() });
  };
  const names = [...new Set([...g.nodes.values()].filter((n) => n.area === 'feature').map((n) => n.feature))];
  /** @type {Record<string, {hash: string, layers: Record<string, string>}>} */
  const features = {};
  for (const f of names) {
    const layers = Object.fromEntries(FEATURE_LAYERS.map((l) => [l, part((n) => n.area === 'feature' && n.feature === f && n.layer === l)]));
    features[/** @type {string} */ (f)] = { hash: part((n) => n.area === 'feature' && n.feature === f), layers };
  }
  const library = part((n) => n.area === 'library');
  const project = hash16({ f: Object.values(features).map((x) => x.hash).sort(), l: library });
  return { project, library, features };
}

/**
 * The structure hashes of a project (the facts' and plan records' form).
 * @param {any} project readLineProject's view.
 * @param {SourceReader} [read]  The project's sources (import edges); pass readerOf(root) for a project on disk.
 * @returns {import('./contract.mjs').StructureHashes}
 */
export function structureOf(project, read) {
  return hashParts(structureGraph(project, read));
}

/**
 * The drafter's view of the hashes: the project, one feature, and that feature's layers.
 * @param {SGraph} g
 * @param {string|null} feature The feature whose hashes to give (null: project only).
 * @returns {{project: string, feature: string|null, layers: Record<string, string>}}
 */
export function hashesOf(g, feature) {
  const h = hashParts(g);
  if (feature === null) return { project: h.project, feature: null, layers: {} };
  const f = h.features[feature];
  const empty = hash16({ n: [], e: [] });
  return { project: h.project, feature: f?.hash ?? empty, layers: f?.layers ?? Object.fromEntries(FEATURE_LAYERS.map((l) => [l, empty])) };
}

/**
 * Apply a BOUND delta (slot refs already replaced by ids) to a copy of the graph.
 * add-node {node, kind, area, feature}; remove-node {node}; move-node {node, to (new id), area, feature} re-points every
 * edge and drops the moved node's base link when it lands in the library; add-edge / remove-edge {from, to, type};
 * set-base {node, to}. Flow ops are accepted and change nothing yet (see the header).
 * @param {SGraph} g
 * @param {{op: string, node?: string, kind?: string, area?: string, feature?: string, from?: string, to?: string, type?: string}[]} delta
 * @returns {SGraph}
 */
export function applyDelta(g, delta) {
  const nodes = new Map([...g.nodes].map(([k, v]) => [k, { ...v }]));
  let edges = g.edges.map((e) => ({ ...e }));
  for (const o of delta) {
    if (o.op === 'add-node') nodes.set(String(o.node), { id: String(o.node), area: o.area === 'library' ? 'library' : 'feature', feature: o.area === 'library' ? null : o.feature ?? null, kind: String(o.kind), layer: KIND_LAYER[String(o.kind)], file: '' });
    else if (o.op === 'remove-node') { nodes.delete(String(o.node)); edges = edges.filter((e) => e.from !== o.node && e.to !== o.node); }
    else if (o.op === 'move-node') {
      const n = nodes.get(String(o.node));
      if (!n) continue;
      const to = String(o.to);
      nodes.delete(String(o.node));
      nodes.set(to, { ...n, id: to, area: o.area === 'library' ? 'library' : n.area, feature: o.area === 'library' ? null : o.feature ?? n.feature });
      edges = edges.map((e) => ({ ...e, from: e.from === o.node ? to : e.from, to: e.to === o.node ? to : e.to }));
      if (o.area === 'library') edges = edges.filter((e) => !(e.type === 'base' && e.from === to));
    } else if (o.op === 'add-edge') { if (!edges.some((e) => e.from === o.from && e.to === o.to && e.type === o.type)) edges.push({ from: String(o.from), to: String(o.to), type: o.type === 'base' ? 'base' : 'import' }); }
    else if (o.op === 'remove-edge') edges = edges.filter((e) => !(e.from === o.from && e.to === o.to && e.type === o.type));
    else if (o.op === 'set-base') { edges = edges.filter((e) => !(e.type === 'base' && e.from === o.node)); edges.push({ from: String(o.node), to: String(o.to), type: 'base' }); }
  }
  edges = edges.filter((e) => nodes.has(e.from) && nodes.has(e.to));
  return { nodes, edges };
}

/**
 * The structural delta between two project views, as item lines built from typed slots (`slot` names each feature,
 * item and library item, e.g. "<feature:F1>"). Never contains a name unless `slot` returns one. (The plan records'
 * form; a drafted route's delta is DELTA_OPS, applied by applyDelta.)
 * @param {any} before @param {any} after
 * @param {(kind: 'feature'|'item'|'lib', name: string, attrs?: Record<string, string>) => string} slot
 * @returns {{added: string[], removed: string[], changed: string[]}}
 */
export function structureDelta(before, after, slot) {
  // Slots are handed out only for what changed, so a record names nothing it does not need.
  const lines = (project) => {
    const m = new Map();
    for (const l of project.library ?? []) m.set(`lib|${l.id}`, { line: () => `library/${l.kind}/${slot('lib', l.id, { kind: l.kind })}`, shape: [l.kind, l.level ?? '-'], base: null });
    for (const f of project.features ?? []) for (const i of f.items ?? []) {
      const base = i.base?.libraryId ?? null;
      m.set(`item|${i.id}`, { line: () => `${slot('feature', f.name)}/${i.kind}/${slot('item', i.id, { kind: i.kind })}`, shape: [i.kind, base ?? 'none'], base });
    }
    return m;
  };
  const a = lines(before); const b = lines(after);
  const out = { added: [], removed: [], changed: [] };
  const show = (x) => { const line = x.line(); return x.base ? `${line} base=${slot('lib', x.base, { kind: x.base.split('/')[0] })}` : line; };
  for (const [k, x] of b) if (!a.has(k)) out.added.push(show(x));
  for (const [k, x] of a) if (!b.has(k)) out.removed.push(show(x));
  for (const [k, x] of b) if (a.has(k) && JSON.stringify(a.get(k).shape) !== JSON.stringify(x.shape)) out.changed.push(show(x));
  for (const v of Object.values(out)) v.sort();
  return out;
}
