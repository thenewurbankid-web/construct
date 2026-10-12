// Line logic verification, step 2 (spec B): the pure/impure split. `classifyUnit({root, file, fn})` answers the unit's
// Purity and its transitive EffectLink chain (contract.mjs), before any step runs. Deterministic, static, no model.
//
// The effect analysis is Morpheus's, not a second scanner: the TS-checker item scan (`loadProgram`, `collectItems`) and
// each item's own facts (`readItem`: Morpheus IMPORT_EFFECTS and the project functions it calls), loaded from the
// source repo through the `@mx/morpheus-import` link (packages/line-links). Morpheus's own `transitive` (scan.ts) keeps
// only the first hop; this walks the same `uses` facts breadth first so `via` holds every item on the way, nearest
// first, as Morpheus itemIds `<file>#<name>`. Two Construct facts fill what Morpheus does not name:
//   logic-map kinds    LOGIC_KIND_EFFECTS (navigation, toast, analytics, storage, io/data -> fetch) inside each item;
//                      reached through an import binding, the binding is the last `via` entry
//   opaque imports     an import that is no Morpheus item (no file, a non-function export, a package): Morpheus cannot
//                      see into it. A call of an HTTP verb on one (`api.post(...)`) is a fetch through it; any other
//                      call adds nothing (the proof layers refuse calls themselves, so that never yields a false proof)
// One link per effect, the shortest `via` first found; links in EFFECT_NAMES order.
//
// No single point of failure: with the link down (no source repo, wrong commit), `classifyLocal` answers from the
// logic map and the domain-purity allowlist's free globals alone (no transitive chain), the pre-step-2 stand-in.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import crypto from 'node:crypto';
import { parseToAst, walkAst, collectImpureDomainReferences } from '@construct/ast';
import { importLinked } from '../../../line-links/index.mjs';
import { EFFECT_NAMES, MORPHEUS_EFFECTS, LOGIC_KIND_EFFECTS } from './contract.mjs';
import { fileUnits } from '../logicMap.mjs';
import { findFunction } from './z3Translate.mjs';

/** @typedef {import('./contract.mjs').EffectLink} EffectLink */
/** @typedef {import('./contract.mjs').EffectName} EffectName */
/** @typedef {import('./contract.mjs').Purity} Purity */

/** Method names that make a call on an opaque import a fetch (service-generator.mjs HTTP_METHODS, minus trace/options/head). */
export const HTTP_VERBS = Object.freeze(new Set(['get', 'post', 'put', 'patch', 'delete', 'request']));

/** Free globals the domain-purity allowlist reports, and the effect each one is (Morpheus importScan names). */
export const GLOBAL_EFFECTS = Object.freeze(/** @type {Record<string, EffectName>} */ ({
  window: 'dom', document: 'dom', navigator: 'dom', location: 'navigation', history: 'navigation', matchMedia: 'dom',
  IntersectionObserver: 'dom', ResizeObserver: 'dom', MutationObserver: 'dom', requestAnimationFrame: 'dom', cancelAnimationFrame: 'dom',
  fetch: 'fetch', XMLHttpRequest: 'fetch', WebSocket: 'fetch', localStorage: 'storage', sessionStorage: 'storage', indexedDB: 'storage',
  setTimeout: 'timer', setInterval: 'timer', clearTimeout: 'timer', clearInterval: 'timer', queueMicrotask: 'timer',
  Date: 'time', performance: 'time', crypto: 'random', console: 'console',
}));

/** One link per effect: the shortest via, first found on ties; EFFECT_NAMES order. */
function chainOf(/** @type {EffectLink[]} */ found) {
  /** @type {Map<EffectName, EffectLink>} */
  const best = new Map();
  for (const l of found) if (!best.has(l.effect) || best.get(l.effect).via.length > l.via.length) best.set(l.effect, l);
  return EFFECT_NAMES.filter((e) => best.has(e)).map((e) => best.get(e));
}

const result = (/** @type {EffectLink[]} */ found) => {
  const effectChain = chainOf(found);
  return { purity: /** @type {Purity} */ (effectChain.length ? 'impure' : 'pure'), effectChain };
};

/**
 * The fallback with Morpheus unlinked: the logic map's effect units inside the function plus the effectful free
 * globals it names. No transitive chain.
 * @param {{root: string, file: string, fn: string}} args
 * @returns {{purity: Purity, effectChain: EffectLink[]}}
 */
export function classifyLocal({ root, file, fn }) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  return localOf(fileUnits(source, file), parseToAst(source), fn);
}

/** classifyLocal on parsed facts: the function's effect units plus the effectful free globals it names. */
function localOf(units, ast, fn) {
  /** @type {EffectLink[]} */
  const found = [];
  for (const u of units) if (u.fn === fn && LOGIC_KIND_EFFECTS[u.kind]) found.push({ effect: LOGIC_KIND_EFFECTS[u.kind], via: [] });
  const node = findFunction(ast, fn);
  if (node) {
    for (const hit of collectImpureDomainReferences(/** @type {any} */ ({ ...ast, body: [node] }))) {
      if (GLOBAL_EFFECTS[hit.name]) found.push({ effect: GLOBAL_EFFECTS[hit.name], via: [] });
    }
  }
  return result(found);
}

/** classifyFile results by file and content hash (bounded; the oldest entry goes first). */
const FILE_CACHE_MAX = 2000;
const fileCache = new Map();

/**
 * The local purity class of every function with logic in one file, in one parse (classifyLocal per function, no
 * transitive chain): function name -> {purity, effects (EffectName[], EFFECT_NAMES order)}. Sync and cached by the
 * file's content, so the logic map and the graph (G1) can carry it on every unit without a measurable build cost.
 * A file that does not parse classifies nothing (an empty map).
 * @param {string} source
 * @param {string} rel  Project-relative path.
 * @returns {Map<string, {purity: Purity, effects: EffectName[]}>}
 */
export function classifyFile(source, rel) {
  const key = `${rel}\0${crypto.createHash('sha1').update(source).digest('hex')}`;
  const hit = fileCache.get(key);
  if (hit) return hit;
  /** @type {Map<string, {purity: Purity, effects: EffectName[]}>} */
  const out = new Map();
  try {
    const units = fileUnits(source, rel);
    const ast = parseToAst(source);
    for (const fn of new Set(units.map((u) => u.fn))) {
      if (fn === '<module>') continue;
      const r = localOf(units, ast, fn);
      out.set(fn, { purity: r.purity, effects: r.effectChain.map((l) => l.effect) });
    }
  } catch { /* does not parse: nothing classified */ }
  if (fileCache.size >= FILE_CACHE_MAX) fileCache.delete(fileCache.keys().next().value);
  fileCache.set(key, out);
  return out;
}

/** Morpheus's scan modules, loaded once through the link; null when the link is down. */
let morpheus;
async function loadMorpheus() {
  if (morpheus !== undefined) return morpheus;
  const r = await importLinked('@mx/morpheus-import');
  if (!r.ok) return (morpheus = null);
  const dir = path.dirname(r.link.entryFile);
  try {
    const [program, items] = await Promise.all(['scanProgram.ts', 'scanItems.ts'].map((f) => import(pathToFileURL(path.join(dir, f)).href)));
    morpheus = { loadProgram: program.loadProgram, collectItems: items.collectItems, readItem: items.readItem };
  } catch {
    morpheus = null;
  }
  return morpheus;
}

/**
 * Whether Morpheus's scan is linked (the classifier then follows calls transitively).
 * @returns {Promise<boolean>} true when the @mx/morpheus-import link loaded
 */
export async function morpheusLinked() {
  return (await loadMorpheus()) !== null;
}

/** Callee root name of a logic-map unit's detail (`toast.success('x')` -> `toast`). */
const detailRoot = (detail) => /^([A-Za-z_$][\w$]*)/.exec(String(detail))?.[1] ?? null;

/**
 * The file's import bindings: local name -> the item id it names and whether Morpheus has that item.
 * @returns {Map<string, {id: string, opaque: boolean}>}
 */
function importBindings(ast, absFile, scan, itemIds) {
  const out = new Map();
  for (const st of ast.body) {
    if (st.type !== 'ImportDeclaration' || st.importKind === 'type') continue;
    const spec = String(st.source.value);
    const resolved = scan.resolveModule(spec, absFile);
    let target;
    if (resolved) target = scan.rel(resolved);
    else if (scan.isProjectSpecifier(spec) && spec.startsWith('.')) target = path.posix.normalize(path.posix.join(path.posix.dirname(scan.rel(absFile)), spec)) + (path.extname(spec) ? '' : path.extname(absFile));
    else target = spec;
    for (const s of st.specifiers) {
      if (s.importKind === 'type') continue;
      const imported = s.type === 'ImportSpecifier' ? (s.imported.name ?? s.imported.value) : s.type === 'ImportDefaultSpecifier' ? 'default' : '*';
      const id = `${target}#${imported}`;
      out.set(s.local.name, { id, opaque: !itemIds.has(id) });
    }
  }
  return out;
}

/**
 * Purity and transitive effect chain of one unit (the function `fn` of `file` under `root`).
 * @param {{root: string, file: string, fn: string}} args  `file` is root-relative.
 * @returns {Promise<{purity: Purity, effectChain: EffectLink[]}>}
 */
export async function classifyUnit({ root, file, fn }) {
  const m = await loadMorpheus();
  if (!m) return classifyLocal({ root, file, fn });
  const absRoot = path.resolve(root);
  const scan = m.loadProgram(absRoot);
  const found = m.collectItems(scan);
  const byId = new Map(found.items.map((i) => [i.itemId, i]));
  const startId = `${file.split(path.sep).join('/')}#${fn}`;
  if (!byId.has(startId)) return classifyLocal({ root, file, fn });
  const itemIds = new Set(byId.keys());

  /** Per file: the parse, its logic-map units and its import bindings. */
  const files = new Map();
  const fileFacts = (item) => {
    if (!files.has(item.file)) {
      const source = item.sf.text;
      const ast = parseToAst(source);
      files.set(item.file, { ast, units: fileUnits(source, item.file), bindings: importBindings(ast, item.sf.fileName, scan, itemIds) });
    }
    return files.get(item.file);
  };

  /** @type {EffectLink[]} */
  const links = [];
  const factsMemo = new Map();
  const factsOf = (item) => { if (!factsMemo.has(item.itemId)) factsMemo.set(item.itemId, m.readItem(scan, found, item, new Set())); return factsMemo.get(item.itemId); };
  /** Effects an item has itself, with the via inside it (empty, or the import binding they go through). */
  const own = (item) => {
    /** @type {EffectLink[]} */
    const out = [];
    for (const effect of factsOf(item).effects.keys()) {
      if (MORPHEUS_EFFECTS[effect]) out.push({ effect: MORPHEUS_EFFECTS[effect], via: [] });
    }
    const { ast, units, bindings } = fileFacts(item);
    for (const u of units) {
      const effect = u.fn === item.name ? LOGIC_KIND_EFFECTS[u.kind] : undefined;
      if (!effect) continue;
      const b = bindings.get(detailRoot(u.detail));
      out.push({ effect, via: b ? [b.id] : [] });
    }
    const node = findFunction(ast, item.name);
    if (node) {
      walkAst(node, {
        enter(n) {
          if (n.type !== 'CallExpression' || n.callee.type !== 'MemberExpression' || n.callee.object.type !== 'Identifier') return;
          const b = bindings.get(n.callee.object.name);
          const prop = n.callee.property;
          const verb = !n.callee.computed && prop.type === 'Identifier' ? prop.name : null;
          if (b?.opaque && verb && HTTP_VERBS.has(verb)) out.push({ effect: 'fetch', via: [b.id] });
        },
      });
    }
    return out;
  };

  // Breadth first over Morpheus's `uses` facts: every item reached once, by its shortest path.
  const seen = new Set([startId]);
  /** @type {{id: string, path: string[]}[]} */
  const queue = [{ id: startId, path: [] }];
  while (queue.length) {
    const { id, path: via } = /** @type {{id: string, path: string[]}} */ (queue.shift());
    const item = byId.get(id);
    for (const l of own(item)) links.push({ effect: l.effect, via: [...via, ...l.via] });
    for (const next of [...factsOf(item).uses.keys()].sort()) {
      if (seen.has(next) || !byId.has(next)) continue;
      seen.add(next);
      queue.push({ id: next, path: [...via, next] });
    }
  }
  return result(links);
}
