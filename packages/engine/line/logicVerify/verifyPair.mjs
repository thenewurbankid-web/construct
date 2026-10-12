// Line logic verification: verifyPair, one unit before and after a step -> one UnitVerdict (contract.mjs). It walks the
// unit's layer order (escalation.mjs layerOrder) cheapest first and stops at the first decisive answer (nextLayer,
// decideUnit). Every build step registers its layers in the one RUNNERS registry below, in escalation.mjs order:
//   round-trip, L0-canonical   step 3 (roundTrip.mjs, canonical.mjs)
//   semantic-diff              no runner: ast/semanticDiff alpha-renames free names too, so on one unit a call to a
//                              different function would read as a rename (an unsound "same"); it stays skipped
//   z3, fast-check             step 6 (z3Prove.mjs, fastCheckLayer.mjs), pure units only
//   isolated                   step 5's layout layer (layoutRun.mjs verifyLayoutPair); step 4's effect runner joins it
// A layer with no runner answers "skipped" and the walk goes on. Skipped layers never decide: a missing layer can only
// leave a unit unverified, never wrongly proven or changed.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseToAst, collectImpureDomainReferences } from '@construct/ast';
import { canonicalCompare, canonicalUnit, unitNames } from './canonical.mjs';
import { roundTripCompare, inBlocks } from './roundTrip.mjs';
import { layerOrder, nextLayer, decideUnit } from './escalation.mjs';
import { buildUnitVerdict } from './verdict.mjs';
import { LOGIC_KIND_EFFECTS } from './contract.mjs';
import { fileUnits } from '../logicMap.mjs';
import { findFunction } from './z3Translate.mjs';
import { z3Layer } from './z3Prove.mjs';
import { fastCheckLayer, minedSeeds } from './fastCheckLayer.mjs';
import { verifyLayoutPair } from './layoutRun.mjs';

/** @typedef {import('./contract.mjs').UnitRef} UnitRef */
/** @typedef {import('./contract.mjs').UnitVerdict} UnitVerdict */
/** @typedef {import('./contract.mjs').LayerResult} LayerResult */
/** @typedef {import('./contract.mjs').VerifyLayer} VerifyLayer */
/** @typedef {import('./contract.mjs').TransformId} TransformId */
/** @typedef {import('./contract.mjs').EffectLink} EffectLink */
/** @typedef {import('./contract.mjs').EffectName} EffectName */
/** @typedef {import('./contract.mjs').EscalationLevel} EscalationLevel */
/** @typedef {import('./roundTrip.mjs').Block} Block */

/**
 * What a layer runner gets: both roots, the unit after the step and the unit before it (null when nothing pairs), both
 * sources of their files (null when missing), the claimed transforms, whether the step extracted the unit, and the
 * results so far.
 * @typedef {object} LayerContext
 * @property {string} beforeRoot
 * @property {string} afterRoot
 * @property {UnitRef} unit
 * @property {{file: string, fn: string}|null} before
 * @property {{file: string, fn: string}} after
 * @property {string|null} beforeSource
 * @property {string|null} afterSource
 * @property {TransformId[]|null} transforms
 * @property {boolean} extracted
 * @property {LayerResult[]} results
 */

/** Two minedSeeds results as one (a moved unit's literals come from both of its files). */
function mergeSeeds(a, b) {
  const uniq = (xs) => [...new Set(xs)];
  const byParam = { ...a.byParam };
  for (const [k, vs] of Object.entries(b.byParam)) byParam[k] = uniq([...(byParam[k] ?? []), ...vs]);
  return { byParam, numbers: uniq([...a.numbers, ...b.numbers]), strings: uniq([...a.strings, ...b.strings]) };
}
const noBefore = (layer) => ({ layer, outcome: /** @type {const} */ ('cant-tell'), reason: 'no unit before the step matches it' });
const bothSides = (ctx) => ctx.before !== null && ctx.beforeSource !== null && ctx.afterSource !== null;

/** @type {Partial<Record<VerifyLayer, (ctx: LayerContext) => LayerResult|Promise<LayerResult>>>} */
export const RUNNERS = {
  'round-trip': (ctx) => (ctx.before
    ? roundTripCompare({ beforeRoot: ctx.beforeRoot, afterRoot: ctx.afterRoot, before: ctx.before, after: ctx.after, transforms: ctx.transforms })
    : noBefore('round-trip')),
  'L0-canonical': (ctx) => {
    if (!ctx.before) return noBefore('L0-canonical');
    // An extracted unit calls what was extracted from it, so its text differs by design; the round-trip compares it.
    if (ctx.extracted) return { layer: 'L0-canonical', outcome: 'skipped', reason: 'an extracted unit is compared by the round-trip' };
    return canonicalCompare({ root: ctx.beforeRoot, ...ctx.before }, { root: ctx.afterRoot, ...ctx.after }, { transforms: ctx.transforms });
  },
  z3: (ctx) => (bothSides(ctx)
    ? z3Layer({ beforeSource: /** @type {string} */ (ctx.beforeSource), afterSource: /** @type {string} */ (ctx.afterSource), fn: ctx.after.fn, beforeFn: ctx.before?.fn, file: ctx.after.file })
    : { layer: 'z3', outcome: 'skipped', reason: 'the unit is missing on one side' }),
  'fast-check': (ctx) => {
    if (!bothSides(ctx)) return { layer: 'fast-check', outcome: 'skipped', reason: 'the unit is missing on one side' };
    // pureExportEquivalence pairs exports by name, so a renamed unit is left to the proof layers
    if (ctx.before?.fn !== ctx.after.fn) return { layer: 'fast-check', outcome: 'skipped', reason: 'the unit was renamed; fast-check pairs exports by name' };
    const seeds = ctx.before.file === ctx.after.file
      ? minedSeeds([ctx.beforeRoot, ctx.afterRoot], ctx.after.file)
      : mergeSeeds(minedSeeds([ctx.beforeRoot], ctx.before.file), minedSeeds([ctx.afterRoot], ctx.after.file));
    return fastCheckLayer({ beforeSource: /** @type {string} */ (ctx.beforeSource), afterSource: /** @type {string} */ (ctx.afterSource), fn: ctx.after.fn, file: ctx.after.file, seeds });
  },
  // step 5's layout layer; step 4's isolated effect runner joins here (one isolated result per unit)
  isolated: (ctx) => {
    if (!ctx.before) return noBefore('isolated');
    try {
      return verifyLayoutPair({ beforeRoot: ctx.beforeRoot, afterRoot: ctx.afterRoot, unit: ctx.unit, beforeFile: ctx.before.file });
    } catch (err) {
      return { layer: 'isolated', outcome: 'cant-tell', reason: `the layout run failed: ${/** @type {Error} */ (err).message}` };
    }
  },
};

const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const sourceFiles = (root) => fs.readdirSync(root, { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile() && SOURCE.test(d.name) && !/\.d\.ts$/.test(d.name))
  .map((d) => path.relative(root, path.join(d.parentPath ?? /** @type {any} */ (d).path, d.name)).split(path.sep).join('/'))
  .filter((f) => !f.split('/').includes('node_modules'))
  .sort();
const read = (root, file) => { try { return fs.readFileSync(path.join(root, file), 'utf8'); } catch { return null; } };

/**
 * The unit before the step that the after unit came from, when the caller does not say: the same file and name; else
 * the one function in the before tree with the same canonical form (a move or a rename), preferring the same name;
 * else the one function with the same name. This is the pairing compareLogicMaps does by fingerprint; a step that knows
 * its own plan (tsFileMove's moves, the rename table) passes `before` instead.
 * @param {string} beforeRoot
 * @param {string} afterRoot
 * @param {{file: string, fn: string}} unit
 * @returns {{file: string, fn: string}|null}
 */
export function pairBefore(beforeRoot, afterRoot, unit) {
  const has = (file, fn) => fs.existsSync(path.join(beforeRoot, file)) && unitNames(fs.readFileSync(path.join(beforeRoot, file), 'utf8')).includes(fn);
  if (has(unit.file, unit.fn)) return { file: unit.file, fn: unit.fn };
  const files = sourceFiles(beforeRoot);
  const named = files.flatMap((file) => unitNames(fs.readFileSync(path.join(beforeRoot, file), 'utf8')).map((fn) => ({ file, fn })));
  const after = canonicalUnit({ root: afterRoot, ...unit });
  if (after) {
    const same = named.filter((u) => canonicalUnit({ root: beforeRoot, ...u })?.text === after.text);
    const pick = same.filter((u) => u.fn === unit.fn).length === 1 ? same.find((u) => u.fn === unit.fn) : same.length === 1 ? same[0] : null;
    if (pick) return pick;
  }
  const byName = named.filter((u) => u.fn === unit.fn);
  return byName.length === 1 ? byName[0] : null;
}

/** Free globals the domain-purity allowlist reports, and the effect each one is (Morpheus importScan names). */
const GLOBAL_EFFECTS = Object.freeze(/** @type {Record<string, EffectName>} */ ({
  window: 'dom', document: 'dom', navigator: 'dom', location: 'navigation', history: 'navigation', matchMedia: 'dom',
  IntersectionObserver: 'dom', ResizeObserver: 'dom', MutationObserver: 'dom', requestAnimationFrame: 'dom', cancelAnimationFrame: 'dom',
  fetch: 'fetch', XMLHttpRequest: 'fetch', WebSocket: 'fetch', localStorage: 'storage', sessionStorage: 'storage', indexedDB: 'storage',
  setTimeout: 'timer', setInterval: 'timer', clearTimeout: 'timer', clearInterval: 'timer', queueMicrotask: 'timer',
  Date: 'time', performance: 'time', crypto: 'random', console: 'console',
}));

/**
 * THE purity stand-in (one function; step 2 replaces it). Purity and effect chain of the unit before the step: step 2's
 * `classifyUnit` (purity.mjs, Morpheus's transitive effect analysis) as soon as that file exists; until then the
 * logic map's effect units inside the function plus the effectful globals it names (the domain-purity allowlist's free
 * references, GLOBAL_EFFECTS). No transitive chain: a call into an impure helper is not seen here, which is safe for
 * the proof layers only because z3 and fast-check refuse calls and impure bodies themselves.
 * @param {{root: string, file: string, fn: string}} args
 * @returns {Promise<{purity: 'pure'|'impure', effectChain: EffectLink[]}>}
 */
export async function classifyBefore({ root, file, fn }) {
  const step2 = path.join(path.dirname(new URL(import.meta.url).pathname), 'purity.mjs');
  if (fs.existsSync(step2)) return (await import(pathToFileURL(step2).href)).classifyUnit({ root, file, fn });
  /** @type {EffectLink[]} */
  const chain = [];
  const add = (effect) => { if (effect && !chain.some((l) => l.effect === effect)) chain.push({ effect, via: [] }); };
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  for (const u of fileUnits(source, file)) if (u.fn === fn) add(LOGIC_KIND_EFFECTS[u.kind]);
  const ast = parseToAst(source);
  const node = findFunction(ast, fn);
  if (node) {
    const ownNames = new Set();
    for (const hit of collectImpureDomainReferences(/** @type {any} */ ({ ...ast, body: [node] }))) ownNames.add(hit.name);
    for (const name of ownNames) add(GLOBAL_EFFECTS[name]);
  }
  return { purity: chain.length ? 'impure' : 'pure', effectChain: chain };
}

/**
 * Verify one unit across a step.
 * @param {object} args
 * @param {string} args.beforeRoot
 * @param {string} args.afterRoot
 * @param {UnitRef} args.unit                      The unit after the step (the logic map's unit).
 * @param {TransformId[]|null} [args.transforms]   The closed-set transforms the step claims; null for a hand edit.
 * @param {EscalationLevel[]} [args.levels]
 * @param {Block[]} [args.blocks]                  The atoms and blocks the step produced; a unit in none is not-extracted.
 * @param {{file: string, fn: string}} [args.before] The unit before the step, when the step knows it (else pairBefore).
 * @returns {Promise<UnitVerdict>}
 */
export async function verifyPair({ beforeRoot, afterRoot, unit, transforms = null, levels = ['L0', 'L1'], blocks, before }) {
  const after = { file: unit.file, fn: unit.fn };
  const pair = before ?? pairBefore(beforeRoot, afterRoot, after);
  const { purity, effectChain } = await classifyBefore(pair ? { root: beforeRoot, ...pair } : { root: afterRoot, ...after });
  const base = { unit, purity, effectChain, transforms };
  if (blocks !== undefined && !inBlocks(unit, blocks)) return buildUnitVerdict({ ...base, ...decideUnit({ results: [], transforms, inBlock: false }) });
  const extracted = Array.isArray(transforms) && transforms.some((t) => t === 'extract-function' || t === 'extract-expression');
  const order = layerOrder(purity, { levels, extracted });
  /** @type {LayerResult[]} */
  const results = [];
  /** @type {LayerContext} */
  const ctx = {
    beforeRoot, afterRoot, unit, before: pair, after, transforms, extracted, results,
    beforeSource: pair ? read(beforeRoot, pair.file) : null, afterSource: read(afterRoot, after.file),
  };
  for (let layer = nextLayer(order, results, transforms); layer; layer = nextLayer(order, results, transforms)) {
    const run = RUNNERS[layer];
    results.push(run ? await run(ctx) : { layer, outcome: 'skipped', reason: 'not built yet' });
  }
  // a skipped layer did not try, so an undecided unit names the last layer that did
  return buildUnitVerdict({ ...base, ...decideUnit({ results: results.filter((r) => r.outcome !== 'skipped'), transforms }) });
}
