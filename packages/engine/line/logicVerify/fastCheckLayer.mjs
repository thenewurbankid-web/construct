// Line logic verification, step 6 (spec C3): the fast-check layer for pure units Z3 cannot take. No second harness: it
// runs ast/pureExportEquivalence (fast-check over the param types) on the one unit, seeded with the literals the
// characterizer mines from both sides (characterize/analyze.mjs pools), and answers as a LayerResult:
//   equivalent -> same-behaviour (a sample: the unit ends "tested", never "proven")
//   diverged   -> changed, with the counterexample as `input` and the differing expression's location
//   skipped / cant-tell pass through (impure by the allowlist, unsupported param types, the time budget)
import fs from 'node:fs';
import path from 'node:path';
import { pureExportEquivalence } from '@construct/ast/pure-export-equivalence';
import { analyzeClosureCached as analyzeClosure } from '../characterize/analyzeCache.mjs';
import { PURE_EQUIVALENCE_OUTCOME } from './contract.mjs';
import { locateUnitDifference } from './canonical.mjs';

/** @typedef {import('./contract.mjs').LayerResult} LayerResult */
/** @typedef {{byParam: Record<string, (string|number)[]>, numbers: number[], strings: string[]}} Seeds */

/**
 * The characterizer's mined literals for one file, merged over the roots it exists in (before and after, so a changed
 * threshold seeds both values). Keyed pools (`age` -> 18, 17, 19 from `age >= 18`) seed that param; the rest seed every
 * param of the matching kind. A root whose file cannot be read adds nothing.
 * @param {string[]} roots Absolute app roots.
 * @param {string} file App-relative file.
 * @returns {Seeds}
 */
export function minedSeeds(roots, file) {
  /** @type {Seeds} */
  const out = { byParam: {}, numbers: [], strings: [] };
  const add = (list, v) => { if (!list.includes(v)) list.push(v); };
  for (const root of roots) {
    if (!fs.existsSync(path.join(root, file))) continue;
    let pools;
    try { ({ pools } = analyzeClosure(root, { files: [file] })); } catch { continue; }
    pools.numbers.forEach((v) => add(out.numbers, v));
    pools.strings.forEach((v) => add(out.strings, v));
    for (const [k, vs] of Object.entries(pools.byKey)) vs.forEach((v) => add(out.byParam[k] ??= [], v));
  }
  return out;
}

/**
 * The fast-check layer for one pure unit.
 * @param {{beforeSource: string, afterSource: string, fn: string, file: string, seeds?: Seeds}} args
 *   `file` is the unit's app-relative after file (for the location); `seeds` from minedSeeds.
 * @returns {LayerResult}
 */
export function fastCheckLayer({ beforeSource, afterSource, fn, file, seeds }) {
  const t0 = performance.now();
  const done = (r) => ({ layer: /** @type {const} */ ('fast-check'), ...r, ms: Math.round(performance.now() - t0) });
  const run = pureExportEquivalence(beforeSource, afterSource, { names: [fn], seeds });
  if (run.reason) return done({ outcome: 'skipped', reason: run.reason });
  const hit = run.checked.find((c) => c.name === fn);
  if (!hit) {
    const skip = run.skipped.find((s) => s.name === fn);
    return done({ outcome: 'skipped', reason: skip?.reason ?? `${fn} is not an exported function whose text changed` });
  }
  const outcome = PURE_EQUIVALENCE_OUTCOME[hit.verdict];
  if (outcome !== 'changed') return done({ outcome, ...(hit.reason ? { reason: hit.reason } : {}) });
  const location = locateUnitDifference({ source: beforeSource, file, fn }, { source: afterSource, file, fn });
  return done({ outcome, input: hit.input, ...(location ? { location } : {}) });
}
