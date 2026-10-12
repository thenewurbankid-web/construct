// Line logic verification: escalation levels L0-L3 (spec F) and the per-unit layer order (spec C) as data, plus the
// "stop at the first decisive layer" policy as pure functions. Running a layer is later steps' work (3-8); this file
// only says which layer runs next and what the results so far decide.
import { LAYER_STRENGTH, LEVEL_OF_LAYER, STRUCTURAL_LAYERS, ESCALATION_LEVELS, inClosedSet } from './contract.mjs';

/** @typedef {import('./contract.mjs').VerifyLayer} VerifyLayer */
/** @typedef {import('./contract.mjs').LayerResult} LayerResult */
/** @typedef {import('./contract.mjs').EscalationLevel} EscalationLevel */
/** @typedef {import('./contract.mjs').TransformId} TransformId */
/** @typedef {import('./contract.mjs').VerdictStatus} VerdictStatus */

/** What each level is and when it runs (spec F). The default stays light: L0 always, L1 for touched units. */
export const LEVELS = Object.freeze([
  Object.freeze({ id: 'L0', runs: 'always', what: 'static checks plus the canonical compare, in milliseconds' }),
  Object.freeze({ id: 'L1', runs: 'touched', what: 'isolated execution in Node, for touched units only' }),
  Object.freeze({ id: 'L2', runs: 'server-rendered', what: "the target's own dev server over HTTP, for server-rendered routes" }),
  Object.freeze({ id: 'L3', runs: 'opt-in', what: 'one shared headless browser, for screenshots, visual diffs or apps that fail in Node' }),
]);

/** The layer order per purity, cheapest first (spec C). Pure units get the strong proofs; impure ones skip to execution. */
export const LAYER_ORDER = Object.freeze({
  pure: Object.freeze(/** @type {VerifyLayer[]} */ (['L0-canonical', 'semantic-diff', 'z3', 'fast-check', 'isolated', 'runtime', 'dev-server', 'browser'])),
  impure: Object.freeze(/** @type {VerifyLayer[]} */ (['L0-canonical', 'semantic-diff', 'isolated', 'runtime', 'dev-server', 'browser'])),
});

/**
 * The levels a unit may escalate to.
 * @param {{touched?: boolean, serverRendered?: boolean, browser?: boolean}} [unit]
 *   touched: the G1 impact graph says the step reached it; serverRendered: its route renders on the server;
 *   browser: the owner opted into L3 (or the app fails in Node).
 * @returns {EscalationLevel[]}
 */
export function levelsFor(unit = {}) {
  /** @type {EscalationLevel[]} */
  const out = ['L0'];
  if (!unit.touched) return out;
  out.push('L1');
  if (unit.serverRendered) out.push('L2');
  if (unit.browser) out.push('L3');
  return out;
}

/**
 * The layers to try for one unit, in order: its purity's order, cut to the levels it may reach, with the extraction
 * round-trip first when the step extracted it.
 * @param {'pure'|'impure'} purity
 * @param {{levels?: EscalationLevel[], extracted?: boolean}} [opts]
 * @returns {VerifyLayer[]}
 */
export function layerOrder(purity, { levels = ['L0', 'L1'], extracted = false } = {}) {
  const allowed = new Set(levels.filter((l) => ESCALATION_LEVELS.includes(l)));
  const order = LAYER_ORDER[purity].filter((l) => allowed.has(LEVEL_OF_LAYER[l]));
  return extracted && allowed.has('L0') ? ['round-trip', ...order] : order;
}

/**
 * Whether a result settles the unit. "same-behaviour" always does (no later layer can do better: proof layers come
 * first). "changed" does, except from a structural layer (text compare) on code edited outside the closed set: there a
 * mismatch only means "not textually the same", so the next layer decides (Alive2-style validation is for transforms).
 * @param {LayerResult} r
 * @param {TransformId[]|null} transforms
 * @returns {boolean}
 */
export function isDecisive(r, transforms) {
  if (r.outcome === 'same-behaviour') return true;
  if (r.outcome !== 'changed') return false;
  return inClosedSet(transforms) || !STRUCTURAL_LAYERS.includes(r.layer);
}

/**
 * The next layer to run, or null to stop (a decisive result, or nothing left).
 * @param {VerifyLayer[]} order From layerOrder.
 * @param {LayerResult[]} results So far.
 * @param {TransformId[]|null} transforms
 * @returns {VerifyLayer|null}
 */
export function nextLayer(order, results, transforms) {
  if (results.some((r) => isDecisive(r, transforms))) return null;
  const done = new Set(results.map((r) => r.layer));
  return order.find((l) => !done.has(l)) ?? null;
}

/**
 * What the results decide for one unit (the verdict fields; verdict.mjs buildUnitVerdict adds the rest).
 *   not in an atom or block            -> not-extracted (round-trip)
 *   first decisive "changed"           -> changed, with its location and input
 *   first decisive "same-behaviour"    -> proven when the edit is in the closed set and the layer is a proof, else tested
 *   nothing decisive                   -> unverified (the last layer tried, or none)
 * @param {{results: LayerResult[], transforms: TransformId[]|null, inBlock?: boolean}} args
 * @returns {{status: VerdictStatus, layer: VerifyLayer, location?: import('./contract.mjs').VerdictLocation, input?: unknown}}
 */
export function decideUnit({ results, transforms, inBlock = true }) {
  if (!inBlock) return { status: 'not-extracted', layer: 'round-trip' };
  const hit = results.find((r) => isDecisive(r, transforms));
  if (!hit) return { status: 'unverified', layer: results.at(-1)?.layer ?? 'none' };
  if (hit.outcome === 'changed') {
    return { status: 'changed', layer: hit.layer, ...(hit.location ? { location: hit.location } : {}), ...(hit.input !== undefined ? { input: hit.input } : {}) };
  }
  const proof = hit.layer !== 'none' && LAYER_STRENGTH[hit.layer] === 'proof';
  return { status: proof && inClosedSet(transforms) ? 'proven' : 'tested', layer: hit.layer };
}
