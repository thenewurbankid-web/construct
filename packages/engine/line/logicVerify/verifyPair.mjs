// Line logic verification: verifyPair, one unit before and after a step -> one UnitVerdict (contract.mjs). It walks the
// unit's layer order (escalation.mjs layerOrder) cheapest first and stops at the first decisive answer (nextLayer,
// decideUnit). Every build step registers its layers in the one RUNNERS registry below, in escalation.mjs order:
//   round-trip, L0-canonical   step 3 (roundTrip.mjs, canonical.mjs)
//   semantic-diff              no runner: ast/semanticDiff alpha-renames free names too, so on one unit a call to a
//                              different function would read as a rename (an unsound "same"); it stays skipped
//   z3, fast-check             step 6 (z3Prove.mjs, fastCheckLayer.mjs), pure units only
//   isolated                   step 5's layout layer (layoutRun.mjs verifyLayoutPair) and step 4's effect runner
//                              (isolatedRun.mjs isolatedPair: a child-process sandbox under the recording fakes)
//   dev-server                 step 8, L2 (devServerRun.mjs devServerPair: the app's own dev server per side, a
//                              fixture server behind generated .env.line stubs, NODE_V8_COVERAGE); only when the
//                              levels include L2
// A layer with no runner answers "skipped" and the walk goes on. Skipped layers never decide: a missing layer can only
// leave a unit unverified, never wrongly proven or changed.
import fs from 'node:fs';
import path from 'node:path';
import { canonicalCompare, canonicalUnit, unitNames } from './canonical.mjs';
import { roundTripCompare, inBlocks } from './roundTrip.mjs';
import { layerOrder, nextLayer, decideUnit } from './escalation.mjs';
import { buildUnitVerdict } from './verdict.mjs';
import { z3Layer } from './z3Prove.mjs';
import { fastCheckLayer, minedSeeds } from './fastCheckLayer.mjs';
import { verifyLayoutPair } from './layoutRun.mjs';
import { isolatedPair } from './isolatedRun.mjs';
import { devServerPair } from './devServerRun.mjs';
import { classifyUnit } from './purity.mjs';

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
 * @property {string[]} [routes]  The server-rendered routes that reach the unit (L2); default: from its file's path.
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
  // one isolated result per unit from step 5's layout layer and step 4's effect runner: a change from either decides;
  // else a layout answer stands; else the effect runner's
  isolated: async (ctx) => {
    if (!ctx.before) return noBefore('isolated');
    /** @type {LayerResult} */
    let layout;
    try {
      layout = verifyLayoutPair({ beforeRoot: ctx.beforeRoot, afterRoot: ctx.afterRoot, unit: ctx.unit, beforeFile: ctx.before.file });
    } catch (err) {
      layout = { layer: 'isolated', outcome: 'cant-tell', reason: `the layout run failed: ${/** @type {Error} */ (err).message}` };
    }
    if (layout.outcome === 'changed') return layout;
    /** @type {LayerResult} */
    let effects;
    try {
      effects = await isolatedPair({ beforeRoot: ctx.beforeRoot, afterRoot: ctx.afterRoot, before: ctx.before, after: ctx.after });
    } catch (err) {
      effects = { layer: 'isolated', outcome: 'cant-tell', reason: `the isolated run failed: ${/** @type {Error} */ (err).message}` };
    }
    return effects.outcome === 'changed' || layout.outcome === 'skipped' ? effects : layout;
  },
  'dev-server': async (ctx) => {
    if (!ctx.before) return noBefore('dev-server');
    try {
      return await devServerPair({ beforeRoot: ctx.beforeRoot, afterRoot: ctx.afterRoot, before: ctx.before, after: ctx.after, routes: ctx.routes });
    } catch (err) {
      return { layer: 'dev-server', outcome: 'cant-tell', reason: `the dev-server run failed: ${/** @type {Error} */ (err).message}` };
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

/**
 * Purity and effect chain of the unit before the step: step 2's `classifyUnit` (purity.mjs, Morpheus's transitive
 * effect analysis; its local fallback when the Morpheus link is down).
 * @param {{root: string, file: string, fn: string}} args
 * @returns {Promise<{purity: 'pure'|'impure', effectChain: EffectLink[]}>}
 */
export function classifyBefore({ root, file, fn }) {
  return classifyUnit({ root, file, fn });
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
 * @param {string[]} [args.routes] L2: the server-rendered routes that reach the unit (else from its file's path).
 * @returns {Promise<UnitVerdict>}
 */
export async function verifyPair({ beforeRoot, afterRoot, unit, transforms = null, levels = ['L0', 'L1'], blocks, before, routes }) {
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
    beforeRoot, afterRoot, unit, before: pair, after, transforms, extracted, results, routes,
    beforeSource: pair ? read(beforeRoot, pair.file) : null, afterSource: read(afterRoot, after.file),
  };
  for (let layer = nextLayer(order, results, transforms); layer; layer = nextLayer(order, results, transforms)) {
    const run = RUNNERS[layer];
    results.push(run ? await run(ctx) : { layer, outcome: 'skipped', reason: 'not built yet' });
  }
  // a skipped layer did not try, so an undecided unit names the last layer that did
  return buildUnitVerdict({ ...base, ...decideUnit({ results: results.filter((r) => r.outcome !== 'skipped'), transforms }) });
}
