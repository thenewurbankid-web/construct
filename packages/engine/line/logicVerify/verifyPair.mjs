// Line logic verification: verifyPair, one unit's verdict across a step (README "Entry points"). It walks the unit's
// layer order (escalation.mjs) cheapest first, stops at the first decisive answer and builds the UnitVerdict.
// Each build step registers its layers in RUNNERS; a layer with no runner yet answers "skipped", which is never
// decisive, so a missing layer can only leave a unit unverified, never wrongly proven or changed.
//   step 6 (this file's first version): z3 and fast-check for pure units.
import fs from 'node:fs';
import path from 'node:path';
import { parseToAst } from '@construct/ast/parse';
import { collectImpureDomainReferences } from '@construct/ast';
import { buildUnitVerdict } from './verdict.mjs';
import { decideUnit, layerOrder, nextLayer } from './escalation.mjs';
import { findFunction } from './z3Translate.mjs';
import { z3Layer } from './z3Prove.mjs';
import { fastCheckLayer, minedSeeds } from './fastCheckLayer.mjs';

/** @typedef {import('./contract.mjs').UnitRef} UnitRef */
/** @typedef {import('./contract.mjs').UnitVerdict} UnitVerdict */
/** @typedef {import('./contract.mjs').LayerResult} LayerResult */
/** @typedef {import('./contract.mjs').VerifyLayer} VerifyLayer */
/** @typedef {import('./contract.mjs').TransformId} TransformId */
/** @typedef {import('./contract.mjs').EscalationLevel} EscalationLevel */
/**
 * What a layer runner gets: both roots, the unit, both sources of its file (null when missing on a side).
 * @typedef {{beforeRoot: string, afterRoot: string, unit: UnitRef, transforms: TransformId[]|null, beforeSource: string|null, afterSource: string|null}} LayerContext
 */

const read = (root, file) => { try { return fs.readFileSync(path.join(root, file), 'utf8'); } catch { return null; } };
const bothSides = (ctx) => ctx.beforeSource !== null && ctx.afterSource !== null;

/** @type {Partial<Record<VerifyLayer, (ctx: LayerContext) => Promise<LayerResult>|LayerResult>>} */
export const RUNNERS = {
  z3: (ctx) => (bothSides(ctx)
    ? z3Layer({ beforeSource: ctx.beforeSource, afterSource: ctx.afterSource, fn: ctx.unit.fn, file: ctx.unit.file })
    : { layer: 'z3', outcome: 'skipped', reason: 'the unit file is missing on one side' }),
  'fast-check': (ctx) => (bothSides(ctx)
    ? fastCheckLayer({ beforeSource: ctx.beforeSource, afterSource: ctx.afterSource, fn: ctx.unit.fn, file: ctx.unit.file, seeds: minedSeeds([ctx.beforeRoot, ctx.afterRoot], ctx.unit.file) })
    : { layer: 'fast-check', outcome: 'skipped', reason: 'the unit file is missing on one side' }),
};

/**
 * Pure or impure. Step 2's purity.mjs (Morpheus's transitive effects) replaces this; until then a unit is pure when the
 * domain-purity allowlist clears its function, and an impure unit is refused, since its effect chain is not known here.
 * @param {string|null} source The before file (the after file when the unit moved).
 * @param {UnitRef} unit
 * @returns {{purity: 'pure', effectChain: []}}
 */
function purityOf(source, unit) {
  const fn = source === null ? null : findFunction(parseToAst(source), unit.fn);
  if (fn && collectImpureDomainReferences({ type: 'Program', body: [fn] }).length === 0) return { purity: 'pure', effectChain: [] };
  throw new TypeError(`${unit.fn} in ${unit.file} needs the step 2 purity split, because it is not a pure top-level function.`);
}

/**
 * One unit's verdict across a step.
 * @param {{beforeRoot: string, afterRoot: string, unit: UnitRef, transforms: TransformId[]|null, levels?: EscalationLevel[], blocks?: unknown[]}} args
 * @returns {Promise<UnitVerdict>}
 */
export async function verifyPair({ beforeRoot, afterRoot, unit, transforms, levels = ['L0', 'L1'] }) {
  /** @type {LayerContext} */
  const ctx = { beforeRoot, afterRoot, unit, transforms, beforeSource: read(beforeRoot, unit.file), afterSource: read(afterRoot, unit.file) };
  const { purity, effectChain } = purityOf(ctx.beforeSource ?? ctx.afterSource, unit);
  const order = layerOrder(purity, { levels });
  /** @type {LayerResult[]} */
  const results = [];
  for (let layer = nextLayer(order, results, transforms); layer; layer = nextLayer(order, results, transforms)) {
    const run = RUNNERS[layer];
    results.push(run ? await run(ctx) : { layer, outcome: 'skipped', reason: 'not built yet' });
  }
  return buildUnitVerdict({ unit, purity, effectChain, transforms, ...decideUnit({ results, transforms }) });
}
