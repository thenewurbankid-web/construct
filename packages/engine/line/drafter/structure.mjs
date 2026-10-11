// Delexicalized structure of a Line project and its hashes (owner 2026-10-11): System 1 sees the structure of the
// current feature and project, and each route is a transition to a predicted target structure.
//
//   graph     nodes = library and feature items {id, area, feature, kind, layer}; edges = base links and import edges
//   roles     derived from the graph only: a library component is an atom (imports no library component), a molecule
//             (imports atoms only) or an organism; library pages are "page", workflows "flow", fixtures "data"; a
//             feature item takes "on:<role of its base>" or "unbased"
//   hashes    sha256 over sorted signatures (area:kind:role, and edges as type:sig>relation:sig where relation is
//             same / library / other feature), at three levels: project, feature, layer. Names never enter, so a
//             rename changes nothing and adding a page changes the feature and project hashes.
//   delta     closed ops (contract.mjs DELTA_OPS) applied in memory give the predicted hashes; verification hashes the
//             scratch copy after the change and compares.
// Gap: flow states and transitions inside a workflow are not modelled yet (a workflow is one node); cw1 adds them.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { readLineProject } from '../model.mjs';
import { KIND_LAYER } from './contract.mjs';

const posix = path.posix;
const SPEC = /(?:\bfrom\s+|\bimport\s*\(\s*|^\s*import\s+)(['"])([^'"\n]+)\1/gm;
const stripExt = (rel) => rel.replace(/\.[cm]?[jt]sx?$|\.json$/, '');

/**
 * @typedef {{id: string, area: 'feature'|'library', feature: string|null, kind: string, layer: string, file: string}} SNode
 * @typedef {{from: string, to: string, type: 'base'|'import'}} SEdge
 * @typedef {{nodes: Map<string, SNode>, edges: SEdge[]}} SGraph
 */

/**
 * The structure graph of a Line project, read from disk.
 * @param {string} root
 * @param {import('../contract.mjs').LineProject} [project]
 * @returns {SGraph}
 */
export function structureOf(root, project = readLineProject(root)) {
  /** @type {Map<string, SNode>} */
  const nodes = new Map();
  for (const l of project.library) nodes.set(l.id, { id: l.id, area: 'library', feature: null, kind: l.kind, layer: KIND_LAYER[l.kind], file: l.file });
  for (const f of project.features) for (const i of f.items) nodes.set(i.id, { id: i.id, area: 'feature', feature: f.name, kind: i.kind, layer: KIND_LAYER[i.kind], file: i.file });
  const byStem = new Map([...nodes.values()].map((n) => [stripExt(n.file), n.id]));
  /** @type {SEdge[]} */
  const edges = [];
  for (const f of project.features) for (const i of f.items) if (i.base.libraryId && nodes.has(i.base.libraryId)) edges.push({ from: i.id, to: i.base.libraryId, type: 'base' });
  for (const n of nodes.values()) {
    if (n.kind === 'fixtures') continue;
    let src = '';
    try { src = fs.readFileSync(path.join(root, n.file), 'utf8'); } catch { continue; }
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

const sha = (x) => crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex').slice(0, 16);

/**
 * The delexicalized hashes of a graph: project, one feature, and that feature's layers.
 * @param {SGraph} g
 * @param {string|null} feature The feature whose hashes to give (null: project only).
 * @returns {import('./contract.mjs').StructureHashes}
 */
export function hashesOf(g, feature) {
  const roles = rolesOf(g);
  const sig = (id) => { const n = g.nodes.get(id); return `${n.area}:${n.kind}:${roles.get(id)}`; };
  const rel = (a, b) => { const x = g.nodes.get(a); const y = g.nodes.get(b); return y.area === 'library' ? 'library' : x.feature === y.feature ? 'same' : 'other'; };
  const edgeSig = (e) => `${e.type}:${sig(e.from)}>${rel(e.from, e.to)}:${sig(e.to)}`;
  const part = (pred) => {
    const ids = [...g.nodes.values()].filter(pred).map((n) => n.id);
    const set = new Set(ids);
    return sha({ n: ids.map(sig).sort(), e: g.edges.filter((e) => set.has(e.from)).map(edgeSig).sort() });
  };
  const features = [...new Set([...g.nodes.values()].filter((n) => n.area === 'feature').map((n) => n.feature))];
  const featureHash = (f) => part((n) => n.area === 'feature' && n.feature === f);
  const project = sha({ f: features.map(featureHash).sort(), l: part((n) => n.area === 'library') });
  if (feature === null) return { project, feature: null, layers: {} };
  /** @type {Record<string, string>} */
  const layers = {};
  for (const layer of ['ui', 'workflow', 'data']) layers[layer] = part((n) => n.area === 'feature' && n.feature === feature && n.layer === layer);
  return { project, feature: featureHash(feature), layers };
}

/**
 * Apply a BOUND delta (slot refs already replaced by ids) to a copy of the graph.
 * add-node {node, kind, area, feature}; remove-node {node}; move-node {node, to (new id), area, feature} re-points every
 * edge and drops the moved node's base link when it lands in the library; add-edge / remove-edge {from, to, type};
 * set-base {node, to}. Flow ops are accepted and change nothing yet (see the header).
 * @param {SGraph} g
 * @param {import('./contract.mjs').DeltaOp[]} delta
 * @returns {SGraph}
 */
export function applyDelta(g, delta) {
  const nodes = new Map([...g.nodes].map(([k, v]) => [k, { ...v }]));
  let edges = g.edges.map((e) => ({ ...e }));
  for (const o of delta) {
    if (o.op === 'add-node') nodes.set(o.node, { id: o.node, area: o.area ?? 'feature', feature: o.area === 'library' ? null : o.feature ?? null, kind: o.kind, layer: KIND_LAYER[o.kind], file: '' });
    else if (o.op === 'remove-node') { nodes.delete(o.node); edges = edges.filter((e) => e.from !== o.node && e.to !== o.node); }
    else if (o.op === 'move-node') {
      const n = nodes.get(o.node);
      if (!n) continue;
      nodes.delete(o.node);
      nodes.set(o.to, { ...n, id: o.to, area: o.area ?? n.area, feature: o.area === 'library' ? null : o.feature ?? n.feature });
      edges = edges.map((e) => ({ ...e, from: e.from === o.node ? o.to : e.from, to: e.to === o.node ? o.to : e.to }));
      if (o.area === 'library') edges = edges.filter((e) => !(e.type === 'base' && e.from === o.to));
    } else if (o.op === 'add-edge') { if (!edges.some((e) => e.from === o.from && e.to === o.to && e.type === o.type)) edges.push({ from: o.from, to: o.to, type: /** @type {any} */ (o.type) }); }
    else if (o.op === 'remove-edge') edges = edges.filter((e) => !(e.from === o.from && e.to === o.to && e.type === o.type));
    else if (o.op === 'set-base') { edges = edges.filter((e) => !(e.type === 'base' && e.from === o.node)); edges.push({ from: o.node, to: o.to, type: 'base' }); }
  }
  edges = edges.filter((e) => nodes.has(e.from) && nodes.has(e.to));
  return { nodes, edges };
}
