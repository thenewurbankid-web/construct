// #949 Trace beam, part 1: one spec point as an AND-OR graph over Line's layers, its costs by Knuth's generalization of
// Dijkstra, and its solution graphs (the candidate paths). No model, no I/O beyond the facts the caller passes.
//
// Layers (owner, path-first): page -> view-model (hook | controller | provider | computed) -> service -> contract ->
// domain. The page is a dumb template binding a view-model; data is api (a service over a contract) or computed (a
// domain function over api fields). An AND node needs all its children, an OR node offers alternatives; a leaf is one
// Trace step (nextSteps order: complete_stub, reuse, add_to_scope, create, create_module) on one stable id.
import { nextSteps } from '../../../lsp/rules.mjs';

/** Step costs: reuse is cheaper than completing a stub, and both are cheaper than creating. */
export const STEP_COST = Object.freeze({ bind: 1, reuse: 1, add_to_scope: 1.5, complete_stub: 2, create: 4, create_module: 5 });
/** The view-model kinds the beam always forks over, and the folder each lives in. */
export const VM_KINDS = Object.freeze({ hook: 'hooks', controller: 'controllers', provider: 'providers', computed: 'expressions' });
/** The folder of each data layer. */
export const LAYER_DIR = Object.freeze({ service: 'services', contract: 'store', domain: 'domains' });
/** Folders a slot of each layer may reuse from (stores are the browser-storage contract in the lending projects). */
export const LAYER_KINDS = Object.freeze({ service: ['services'], contract: ['store', 'contracts'], domain: ['domains', 'expressions'] });

const cap1 = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const low1 = (s) => s.charAt(0).toLowerCase() + s.slice(1);
/**
 * A page's base name: BookPage -> Book.
 * @param {string} name
 * @returns {string}
 */
export const pageBase = (name) => String(name).replace(/Page$/, '') || String(name);
/**
 * The view-model unit a page binds, per kind: BookPage -> useBook, bookController, BookProvider, bookView.
 * @param {string} kind One of VM_KINDS.
 * @param {string} page The page name.
 * @returns {string}
 */
export function vmName(kind, page) {
  const b = pageBase(page);
  return { hook: `use${cap1(b)}`, controller: `${low1(b)}Controller`, provider: `${cap1(b)}Provider`, computed: `${low1(b)}View` }[kind];
}
/**
 * Lower-case word tokens of an identifier: pickedBooks -> ['picked', 'book'].
 * @param {string} s
 * @returns {string[]}
 */
export const tokens = (s) => String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean).map((t) => t.replace(/s$/, ''));

/**
 * Build the AND-OR graph of one point.
 * @param {any} point {id, feature, page: {name, file, exists, stub}|null, traits: {state, action, shared}, slots: Slot[]}
 *   Slot = {id, kind: 'api'|'computed'|'action', layer: 'service'|'contract'|'domain', name, feature?, entity?, in?, out?,
 *   examples?, from?: string[], contract?: {target, exists}, dir?: the folder when not the layer's default}
 * @param {{fns: Map<string, any>, modules: Set<string>, exportsBy: Record<string, string[]>}} facts beamFacts(root).
 * @param {{root?: string, inScope?: Set<string>}} [o] `inScope`: the features `point.feature` already imports.
 * @returns {{root: string, nodes: Map<string, any>, point: any}}
 */
export function buildGraph(point, facts, o = {}) {
  const nodes = new Map();
  const add = (n) => { if (!nodes.has(n.id)) nodes.set(n.id, { weight: 0, children: [], ...n }); return n.id; };
  const leaf = (stepOpt, extra = {}) => {
    const id = `leaf:${extra.slot ?? extra.vm ?? extra.layer ?? '-'}:${stepOpt.step}:${stepOpt.target}`;
    return add({ id, type: 'LEAF', step: stepOpt.step, target: stepOpt.target, weight: STEP_COST[stepOpt.step] ?? 9, reason_id: stepOpt.reason_id, why: stepOpt.why ?? null, ...extra });
  };
  const stepsFor = (need, layer, extra = {}) => {
    const n = nextSteps(o.root ?? '.', { need, from: point.feature }, { facts });
    if (!n.ok) return [];
    return n.options.map((opt) => {
      const scoped = opt.step === 'add_to_scope' && o.inScope?.has(need.split('/')[0]);
      return leaf(scoped ? { ...opt, step: 'reuse', reason_id: 'IN_SCOPE_ALREADY' } : opt, { need, layer, ...extra });
    });
  };

  // a data slot: OR over every existing function that could fill it (stable ids in its layer's folders), and its own id
  const slotNode = (slot) => {
    const sid = `slot:${slot.id}`;
    if (nodes.has(sid)) return sid;
    const home = slot.feature ?? point.feature;
    const ownId = `${home}/${slot.dir ?? LAYER_DIR[slot.layer]}/${slot.name}`;
    const want = new Set(tokens(slot.entity ?? slot.name));
    const ids = [ownId];
    for (const f of [...facts.fns.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      if (![...LAYER_KINDS[slot.layer], slot.dir].includes(f.kind) || ids.includes(f.id)) continue;
      if (tokens(f.name).some((t) => want.has(t))) ids.push(f.id);
    }
    const kids = [];
    for (const need of ids) {
      const fn = facts.fns.get(need);
      const opts = fn ? stepsFor(need, slot.layer, { slot: slot.id }) : need === ownId ? stepsFor(need, slot.layer, { slot: slot.id }) : [];
      if (fn && !opts.length) kids.push(leaf({ step: 'out_of_scope', target: need, reason_id: 'NOT_EXPORTED' }, { need, layer: slot.layer, slot: slot.id, weight: Infinity }));
      for (const l of opts) {
        const s = nodes.get(l).step;
        // a function still to write needs what it reads: a service its contract, a computed value the api fields it uses
        const below = [];
        if ((s === 'create' || s === 'create_module' || s === 'complete_stub') && slot.contract) {
          below.push(leaf({ step: slot.contract.exists ? 'reuse' : 'create', target: slot.contract.target, reason_id: slot.contract.exists ? 'CONTRACT_SOURCE' : 'NO_CONTRACT' }, { layer: 'contract', slot: slot.id }));
        }
        for (const d of slot.from ?? []) { const ds = point.slots.find((x) => x.id === d); if (ds) below.push(slotNode(ds)); }
        kids.push(below.length ? add({ id: `and:${l}`, type: 'AND', children: [l, ...below] }) : l);
      }
    }
    add({ id: sid, type: 'OR', slot: slot.id, layer: slot.layer, children: kids });
    return sid;
  };

  const top = [];
  if (point.page) {
    const pageId = `${point.feature}/pages/${point.page.name}`;
    const step = point.page.exists ? (point.page.stub ? 'complete_stub' : 'bind') : 'create';
    top.push(add({ id: 'or:page', type: 'OR', layer: 'page', children: [leaf({ step, target: pageId, reason_id: point.page.exists ? 'PAGE_EXISTS' : 'NO_PAGE' }, { layer: 'page', need: pageId })] }));
    const vmKids = [];
    for (const [kind, dir] of Object.entries(VM_KINDS)) {
      const need = `${point.feature}/${dir}/${vmName(kind, point.page.name)}`;
      const unit = add({ id: `or:vm:${kind}`, type: 'OR', layer: kind, children: stepsFor(need, kind, { vm: kind }) });
      vmKids.push(add({ id: `and:vm:${kind}`, type: 'AND', vm: kind, children: [unit, ...point.slots.map(slotNode)] }));
    }
    top.push(add({ id: 'or:vm', type: 'OR', layer: 'view-model', children: vmKids }));
  } else {
    for (const s of point.slots) top.push(slotNode(s));
  }
  add({ id: 'root', type: 'AND', children: top });
  return { root: 'root', nodes, point };
}

/**
 * Knuth's generalization of Dijkstra (1977) over the AND-OR graph: an AND node costs its weight plus all its children,
 * an OR node its cheapest child; a node is final once its value cannot drop (all AND children final, or the first OR
 * child popped). A `blocked` node (pruned) costs Infinity.
 * @param {{nodes: Map<string, any>, root: string}} g
 * @param {Set<string>} [blocked]
 * @returns {{cost: Map<string, number>, best: Map<string, string>}} `best`: the cheapest child per OR node.
 */
export function knuthCosts(g, blocked = new Set()) {
  const parents = new Map();
  for (const n of g.nodes.values()) for (const c of n.children) { if (!parents.has(c)) parents.set(c, []); parents.get(c).push(n.id); }
  const cost = new Map(); const best = new Map(); const final = new Set();
  const pending = new Map([...g.nodes.values()].filter((n) => n.type === 'AND').map((n) => [n.id, new Set(n.children)]));
  const queue = []; // [cost, id], popped cheapest first, ties by id
  const push = (c, id) => { queue.push([c, id]); queue.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1])); };
  for (const n of g.nodes.values()) {
    if (n.type === 'LEAF') push(blocked.has(n.id) ? Infinity : n.weight, n.id);
    else if (n.type === 'AND' && !n.children.length) push(blocked.has(n.id) ? Infinity : n.weight, n.id);
    else if (n.type === 'OR' && !n.children.length) push(Infinity, n.id);
  }
  while (queue.length) {
    const [c, id] = queue.shift();
    if (final.has(id)) continue;
    final.add(id); cost.set(id, c);
    for (const p of parents.get(id) ?? []) {
      if (final.has(p)) continue;
      const pn = g.nodes.get(p);
      if (pn.type === 'OR') { if (!best.has(p)) { best.set(p, id); push(blocked.has(p) ? Infinity : c, p); } }
      else {
        const left = pending.get(p); left.delete(id);
        if (!left.size) push(blocked.has(p) ? Infinity : pn.weight + pn.children.reduce((s, k) => s + cost.get(k), 0), p);
      }
    }
  }
  for (const n of g.nodes.values()) if (!cost.has(n.id)) cost.set(n.id, Infinity);
  return { cost, best };
}

/**
 * Every solution graph (one child per OR node, shared nodes chosen once), cheapest OR children first, at most `limit`.
 * @param {{nodes: Map<string, any>, root: string}} g
 * @param {Map<string, number>} order Per node the cost used to order OR children (knuthCosts().cost).
 * @param {number} [limit]
 * @returns {{choice: Record<string, string>, leaves: string[]}[]} Each candidate: the child picked per OR node and its leaves.
 */
export function solutionGraphs(g, order, limit = 512) {
  const out = [];
  const kids = (n) => [...n.children].sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0) || a.localeCompare(b));
  const walk = (stack, choice) => {
    if (out.length >= limit) return;
    if (!stack.length) {
      const leaves = new Set(); const seen = new Set(); const todo = [g.root];
      while (todo.length) {
        const id = todo.pop(); if (seen.has(id)) continue; seen.add(id);
        const n = g.nodes.get(id);
        if (n.type === 'LEAF') leaves.add(id); else if (n.type === 'OR') todo.push(choice[id]); else todo.push(...n.children);
      }
      out.push({ choice: { ...choice }, leaves: [...leaves].sort() });
      return;
    }
    const [id, ...rest] = stack;
    const n = g.nodes.get(id);
    if (n.type === 'LEAF') return walk(rest, choice);
    if (n.type === 'AND') return walk([...n.children, ...rest], choice);
    if (choice[id]) return walk([choice[id], ...rest], choice);
    if (!n.children.length) return; // an OR with nothing to offer: no solution through it
    for (const k of kids(n)) { choice[id] = k; walk([k, ...rest], choice); delete choice[id]; if (out.length >= limit) return; }
  };
  walk([g.root], {});
  return out;
}
