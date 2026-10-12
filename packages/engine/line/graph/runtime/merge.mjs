// G2: runtime records -> the graph's runtime layer, and "reached at runtime" per logic-map unit.
//   resolveRef(ref, map)                -> the LogicUnit a recorded caller/callee is, or null
//   mergeRuntime(graph, records, {map}) -> RuntimeMerge (CALLED_AT_RUNTIME edges with test evidence, shapes beside them,
//                                          fetches, state writes, unreached units)
//   runtimeCoverage(map, records)       -> RuntimeCoverage (function-level reach, next to istanbul's line coverage)
// Resolution is by module identity, then by name when the file moved: a recorded {file, name} finds the export unit
// of that name in that file, else the one export unit of that name anywhere in the map (so a mock or a record taken
// before a move still lands on the moved unit).
import { createRequire } from 'node:module';
import { RUNTIME_EDGE_TYPE, RUNTIME_LAYER, unitNodeId } from './contract.mjs';

const require = createRequire(import.meta.url);
const { handlerHash } = require('./recorder.cjs');

/** @typedef {import('./contract.mjs').RuntimeRef} RuntimeRef */
/** @typedef {import('./contract.mjs').RuntimeRecord} RuntimeRecord */
/** @typedef {{id: string, fingerprint: string, kind: string, file: string, fn: string, line: number, detail: string}} Unit */

/** The names an export unit declares (its detail is "<shape> <name>[, <shape> <name>]"). */
const exportNames = (u) => u.detail.split(',').map((s) => s.trim().split(/\s+/).pop());

/**
 * The logic-map unit a recorded caller, callee or state write is: by its file first, then by name anywhere in the map.
 * @param {RuntimeRef|{kind: 'state', file: string, owner: string, key: string}} ref
 * @param {{units: Unit[]}} map
 * @returns {Unit|null}
 */
export function resolveRef(ref, map) {
  if (!ref) return null;
  if (ref.kind === 'export') {
    const base = ref.name.split('.')[0];
    const name = base === 'default' ? ref.local ?? base : base;
    const all = map.units.filter((u) => u.kind === 'export' && exportNames(u).includes(name));
    const here = all.filter((u) => u.file === ref.file);
    if (here.length) return here[0];
    return all.length === 1 ? all[0] : null;
  }
  if (ref.kind === 'handler') {
    const of = (list) => list.filter((u) => u.kind === 'handler' && u.fn === ref.owner && u.detail.startsWith(`${ref.prop}=`));
    let cands = of(map.units.filter((u) => u.file === ref.file));
    if (!cands.length) cands = of(map.units);
    if (cands.length === 1) return cands[0];
    return cands.find((u) => handlerHash(u.detail.slice(ref.prop.length + 1)) === ref.hash) ?? null;
  }
  if (ref.kind === 'state') {
    const named = new RegExp(`^\\[?\\s*${ref.key.replace(/[$]/g, '\\$')}\\b`);
    const of = (list) => list.filter((u) => u.kind === 'state' && u.fn === ref.owner && named.test(u.detail));
    const here = of(map.units.filter((u) => u.file === ref.file));
    if (here.length) return here[0];
    const all = of(map.units);
    return all.length === 1 ? all[0] : null;
  }
  return null;
}

const refKey = (r) => JSON.stringify(r);

/**
 * Function-level reach: an export or handler unit is reached when it ran (a jest mock standing in for it does not
 * count: it is listed under `mocked`); any other unit is reached when the function holding it ran (its `fn`, a JSX
 * handler of that prop, or the export it sits under), or, at module level, when its file loaded.
 * @param {{units: Unit[]}} map
 * @param {RuntimeRecord[]} records
 * @returns {import('./contract.mjs').RuntimeCoverage}
 */
export function runtimeCoverage(map, records) {
  const ran = new Set();
  const mocked = new Set();
  const ranFns = new Set(); // `${file}#${fn}`
  const ranProps = new Set(); // `${file}#on:${prop}`
  const loaded = new Set();
  const cache = new Map();
  const resolve = (ref) => { const k = refKey(ref); if (!cache.has(k)) cache.set(k, resolveRef(ref, map)); return cache.get(k); };
  for (const r of records) {
    if (r.kind === 'load' && r.file) loaded.add(r.file);
    if (r.kind !== 'call' || !r.to) continue;
    const u = resolve(r.to);
    if (!u) continue;
    if (r.mocked) { mocked.add(u.fingerprint); continue; }
    ran.add(u.fingerprint);
    loaded.add(u.file);
    if (r.to.kind === 'handler') { ranProps.add(`${u.file}#on:${r.to.prop}`); }
    else for (const n of exportNames(u)) ranFns.add(`${u.file}#${n}`);
    if (r.to.kind === 'export' && r.to.local) ranFns.add(`${u.file}#${r.to.local}`);
  }
  // the export unit each line sits under (for helpers nested in an exported function)
  const exportsByFile = new Map();
  for (const u of map.units) if (u.kind === 'export') { if (!exportsByFile.has(u.file)) exportsByFile.set(u.file, []); exportsByFile.get(u.file).push(u); }
  for (const list of exportsByFile.values()) list.sort((a, b) => a.line - b.line);
  const reachedUnit = (u) => {
    if (u.kind === 'export' || u.kind === 'handler') return ran.has(u.fingerprint);
    if (u.fn === '<module>') return loaded.has(u.file);
    if (ranFns.has(`${u.file}#${u.fn}`) || ranProps.has(`${u.file}#${u.fn}`)) return true;
    const holder = (exportsByFile.get(u.file) ?? []).filter((e) => e.line <= u.line).pop();
    return holder ? ran.has(holder.fingerprint) : false;
  };
  const reached = [];
  const unreached = [];
  /** @type {Record<string, {reached: number, total: number}>} */
  const byKind = {};
  for (const u of map.units) {
    const ok = reachedUnit(u);
    (ok ? reached : unreached).push(u.fingerprint);
    byKind[u.kind] ??= { reached: 0, total: 0 };
    byKind[u.kind].total++;
    if (ok) byKind[u.kind].reached++;
  }
  const total = map.units.length;
  const sentence = `${reached.length} of ${total} logic units ran in a test${unreached.length ? `; ${unreached.length} never ran` : ''}${mocked.size ? `; ${mocked.size} were only called as mocks` : ''}.`;
  return { total, reached, unreached, mocked: [...mocked], byKind, sentence };
}

/**
 * Turn runtime records into the graph's runtime layer. Edges whose ends are not nodes of `graph` (when it has nodes)
 * are left out and listed under `unresolved`; any earlier runtime-layer edges of `graph` are replaced.
 * @param {{nodes?: {id: string}[], edges?: object[]}} graph
 * @param {RuntimeRecord[]} records
 * @param {{map: {units: Unit[]}}} opts
 * @returns {import('./contract.mjs').RuntimeMerge}
 */
export function mergeRuntime(graph, records, opts) {
  const map = opts?.map;
  if (!map?.units) throw new TypeError('mergeRuntime must be given the logic map ({map}) to resolve recorded functions to units.');
  const nodes = new Set((graph?.nodes ?? []).map((n) => n.id));
  const known = (id) => !nodes.size || nodes.has(id);
  const cache = new Map();
  const unresolved = new Map();
  const resolve = (ref) => {
    if (!ref) return null;
    const k = refKey(ref);
    if (!cache.has(k)) {
      const u = resolveRef(ref, map);
      cache.set(k, u ? unitNodeId(u) : null);
      if (!u) unresolved.set(k, { ref, why: 'No logic-map unit matches it.' });
      else if (!known(unitNodeId(u))) unresolved.set(k, { ref, why: `${unitNodeId(u)} is not a node of the graph.` });
    }
    const id = cache.get(k);
    return id && known(id) ? id : null;
  };

  const edgeAgg = new Map();
  /** @type {Record<string, {args: string[], ret: string[]}>} */
  const shapes = {};
  const addShape = (key, args, ret) => {
    const s = (shapes[key] ??= { args: [], ret: [] });
    if (args && !s.args.includes(args)) s.args.push(args);
    if (ret && !s.ret.includes(ret)) s.ret.push(ret);
  };
  const addEdge = (from, to, test, count) => {
    if (!from || !to || from === to) return;
    const t = test ?? 'unnamed test';
    const k = `${from}\u0000${to}\u0000${t}`;
    const had = edgeAgg.get(k);
    if (had) had.evidence.count += count;
    else edgeAgg.set(k, { from, to, type: RUNTIME_EDGE_TYPE, layer: RUNTIME_LAYER, evidence: { test: t, count } });
  };
  const io = new Map();
  const writes = new Map();
  for (const r of records) {
    if (r.kind === 'call') {
      const from = resolve(r.from);
      const to = resolve(r.to);
      if (from && to && from !== to) {
        addEdge(from, to, r.test, r.count);
        addShape(`${from} -> ${to}`, (r.args ?? []).join(', '), r.ret);
      }
    } else if (r.kind === 'state') {
      const from = resolve(r.from);
      const to = resolve({ kind: 'state', file: r.file, owner: r.owner, key: r.key });
      addEdge(from, to, r.test, r.count);
      const k = `${from}|state|${r.key}|${to}`;
      if (!writes.has(k)) writes.set(k, { from, kind: 'state', key: r.key, to, test: r.test });
    } else if (r.kind === 'dispatch') {
      const from = resolve(r.from);
      const k = `${from}|dispatch|${r.key}`;
      if (!writes.has(k)) writes.set(k, { from, kind: 'dispatch', key: r.key, to: null, test: r.test });
    } else if (r.kind === 'fetch') {
      const from = resolve(r.from);
      const k = `${from}|${r.method}|${r.url}`;
      const had = io.get(k);
      if (had) had.count += r.count;
      else io.set(k, { from, method: r.method, url: r.url, test: r.test, count: r.count });
    }
  }
  const edges = [...edgeAgg.values()].sort((a, b) => (a.from + a.to + a.evidence.test).localeCompare(b.from + b.to + b.evidence.test));
  const cov = runtimeCoverage(map, records);
  const missed = new Set(cov.unreached);
  const unreached = map.units.filter((u) => missed.has(u.fingerprint)).map((u) => ({ fingerprint: u.fingerprint, id: u.id, kind: u.kind, file: u.file, fn: u.fn, line: u.line }));
  return {
    graph: { ...graph, nodes: graph?.nodes ?? [], edges: [...(graph?.edges ?? []).filter((e) => /** @type {any} */ (e).layer !== RUNTIME_LAYER), ...edges] },
    edges,
    shapes,
    io: [...io.values()],
    writes: [...writes.values()],
    reached: cov.reached,
    unreached,
    mocked: cov.mocked,
    unresolved: [...unresolved.values()],
  };
}
