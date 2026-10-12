// Line logic verification: verifyPair, one unit before and after a step -> one UnitVerdict (contract.mjs). It runs the
// unit's layers cheapest first (escalation.mjs layerOrder) and stops at the first decisive one (nextLayer, decideUnit).
// Step 3 provides the L0 layers: the extraction round-trip (roundTrip.mjs) and the C1 canonical compare (canonical.mjs).
// Steps 4 to 6 and 8 add their layers to RUNNERS; until a layer has a runner the walk stops there, so a unit nothing
// decided yet is "unverified", never assumed fine.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { canonicalCompare, canonicalUnit, unitNames } from './canonical.mjs';
import { roundTripCompare, inBlocks } from './roundTrip.mjs';
import { layerOrder, nextLayer, decideUnit } from './escalation.mjs';
import { buildUnitVerdict } from './verdict.mjs';
import { LOGIC_KIND_EFFECTS } from './contract.mjs';
import { fileUnits } from '../logicMap.mjs';

/** @typedef {import('./contract.mjs').UnitRef} UnitRef */
/** @typedef {import('./contract.mjs').UnitVerdict} UnitVerdict */
/** @typedef {import('./contract.mjs').LayerResult} LayerResult */
/** @typedef {import('./contract.mjs').TransformId} TransformId */
/** @typedef {import('./contract.mjs').EffectLink} EffectLink */
/** @typedef {import('./contract.mjs').EscalationLevel} EscalationLevel */
/** @typedef {import('./roundTrip.mjs').Block} Block */

/**
 * What a layer runner gets.
 * @typedef {{beforeRoot: string, afterRoot: string, before: {file: string, fn: string}|null, after: {file: string, fn: string}, transforms: TransformId[]|null, extracted: boolean, results: LayerResult[]}} LayerContext
 */

/** @type {Partial<Record<import('./contract.mjs').VerifyLayer, (ctx: LayerContext) => LayerResult|Promise<LayerResult>>>} */
export const RUNNERS = {
  'round-trip': (ctx) => (ctx.before
    ? roundTripCompare({ beforeRoot: ctx.beforeRoot, afterRoot: ctx.afterRoot, before: ctx.before, after: ctx.after, transforms: ctx.transforms })
    : { layer: 'round-trip', outcome: 'cant-tell', reason: 'no unit before the step matches it' }),
  'L0-canonical': (ctx) => {
    if (!ctx.before) return { layer: 'L0-canonical', outcome: 'cant-tell', reason: 'no unit before the step matches it' };
    // An extracted unit calls what was extracted from it, so its text differs by design; the round-trip compares it.
    if (ctx.extracted) return { layer: 'L0-canonical', outcome: 'skipped', reason: 'an extracted unit is compared by the round-trip' };
    return canonicalCompare({ root: ctx.beforeRoot, ...ctx.before }, { root: ctx.afterRoot, ...ctx.after }, { transforms: ctx.transforms });
  },
};

const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const sourceFiles = (root) => fs.readdirSync(root, { recursive: true, withFileTypes: true })
  .filter((d) => d.isFile() && SOURCE.test(d.name) && !/\.d\.ts$/.test(d.name))
  .map((d) => path.relative(root, path.join(d.parentPath ?? /** @type {any} */ (d).path, d.name)).split(path.sep).join('/'))
  .filter((f) => !f.split('/').includes('node_modules'))
  .sort();

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
 * Purity and effect chain of the unit before the step: step 2's classifyUnit (purity.mjs, Morpheus's transitive effect
 * analysis) when it is built; until then the logic map's own effect units inside the function (no transitive chain).
 * @param {{root: string, file: string, fn: string}} args
 * @returns {Promise<{purity: 'pure'|'impure', effectChain: EffectLink[]}>}
 */
export async function classifyBefore({ root, file, fn }) {
  const step2 = path.join(path.dirname(new URL(import.meta.url).pathname), 'purity.mjs');
  if (fs.existsSync(step2)) return (await import(pathToFileURL(step2).href)).classifyUnit({ root, file, fn });
  /** @type {EffectLink[]} */
  const chain = [];
  for (const u of fileUnits(fs.readFileSync(path.join(root, file), 'utf8'), file)) {
    const effect = LOGIC_KIND_EFFECTS[u.kind];
    if (u.fn === fn && effect && !chain.some((l) => l.effect === effect)) chain.push({ effect, via: [] });
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
  for (let layer = nextLayer(order, results, transforms); layer; layer = nextLayer(order, results, transforms)) {
    const run = RUNNERS[layer];
    if (!run) break;
    results.push(await run({ beforeRoot, afterRoot, before: pair, after, transforms, extracted, results }));
  }
  return buildUnitVerdict({ ...base, ...decideUnit({ results, transforms }) });
}
