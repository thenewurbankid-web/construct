// Line logic verification, step 1: the CONTRACT (docs/line/HANDOVER-2026-10-12-import.md, "Line logic verification
// (owner, 2026-10-12)"). The ONE place the verification shapes live: closed id lists, typedefs and runtime shape checks.
// No verification logic here; the builder and the sentence are verdict.mjs, the layer policy is escalation.mjs.
// Pure: it imports only the Import v2 contract (itself import-free), so Cockpit's mock mode reads it too.
//
// Shapes it extends instead of inventing parallel ones:
//   unit          G2 runtime contract's UnreachedUnit {fingerprint, id, kind, file, fn, line} (a LogicUnit without
//                 detail/anchor); `fingerprint` is the logic map's (importV2 LogicUnit.fingerprint), G1 node `unit:<fp>`
//   kind          importV2 LOGIC_UNIT_KINDS / LOGIC_UNIT_WORDS
//   effects       Morpheus contracts/importScan IMPORT_EFFECTS (fetch dom storage timer random time console mutation
//                 throw) plus the logic map's effect kinds (navigation, toast, analytics) and the G2 `dispatch` (store)
//   effectChain   Morpheus scan.ts transitive effects: effect -> first site, `via` the Morpheus itemId `<file>#<name>`
//   location      LogicUnit's app-relative POSIX `file` and 1-based `line`; Morpheus ErrorLocation's optional `column`
//   layer outcome ast/semanticDiff SEMANTIC_DIFF_VERDICTS (same-behaviour | changed | cant-tell) plus `skipped`
//                 (ast/pureExportEquivalence's verdicts map onto it: PURE_EQUIVALENCE_OUTCOME)
//
// Every assert* throws a TypeError whose message is one plain-English sentence naming the bad field.
import { LOGIC_UNIT_KINDS } from '../importV2/contract.mjs';

/** @typedef {import('../importV2/contract.mjs').LogicUnitKind} LogicUnitKind */

/**
 * A logic-map unit by reference: the G2 runtime contract's UnreachedUnit shape (graph/runtime/contract.mjs).
 * @typedef {{fingerprint: string, id: string, kind: LogicUnitKind, file: string, fn: string, line: number}} UnitRef
 */

/** @typedef {'pure'|'impure'} Purity */

/**
 * @typedef {'proven'|'tested'|'unverified'|'changed'|'not-extracted'} VerdictStatus
 *   proven         a closed-set transform, and a proof layer found the unit unchanged
 *   tested         a sample layer found no difference, or the code was edited outside the closed set (never proven)
 *   unverified     no layer could decide; never assumed fine
 *   changed        a layer found a difference; the verdict names its exact location
 *   not-extracted  the round-trip check found the unit in no atom or block
 */

/**
 * @typedef {'L0-canonical'|'round-trip'|'semantic-diff'|'z3'|'fast-check'|'isolated'|'runtime'|'dev-server'|'browser'|'none'} VerifyLayer
 */

/** @typedef {'move'|'rename'|'extract-function'|'extract-expression'|'wrap-adapter'|'repoint-imports'|'repoint-mocks'} TransformId */

/**
 * @typedef {'fetch'|'storage'|'navigation'|'store'|'timer'|'toast'|'analytics'|'dom'|'random'|'time'|'console'|'mutation'|'throw'} EffectName
 */

/**
 * One link of a unit's transitive effect chain (Morpheus scan.ts `transitive`): the effect, and the items it is reached
 * through, nearest first (Morpheus itemIds `<file>#<name>`); `via` is empty when the unit has the effect itself.
 * @typedef {{effect: EffectName, via: string[]}} EffectLink
 */

/**
 * Where a unit changed. `astPath` starts at the enclosing named function (LogicUnit.fn, or `<module>`) and walks down
 * one ESTree node per segment (typescript-estree, the parse the logic map uses): `<Type>.<key>` or `<Type>.<key>[<i>]`
 * names the child taken, and a last `<Type>.<key>` may name a primitive field (an operator). Example:
 * `isAdult/FunctionDeclaration.body/BlockStatement.body[0]/ReturnStatement.argument/BinaryExpression.operator`.
 * `side` says which code the place is in: `after` (the default) or `before` (a dropped statement exists only there).
 * @typedef {{astPath: string, file: string, line: number, column?: number, side?: 'before'|'after'}} VerdictLocation
 */

/**
 * The one result per logic unit of a checked step.
 * @typedef {object} UnitVerdict
 * @property {UnitRef} unit
 * @property {Purity} purity
 * @property {EffectLink[]} effectChain       Empty exactly when the unit is pure; the chain BEFORE the step.
 * @property {VerdictStatus} status
 * @property {VerifyLayer} layer              The layer that decided (the last one tried when unverified).
 * @property {TransformId[]|null} transforms  The closed-set transforms the step applied to this unit ([]: untouched);
 *   null when the unit was edited outside the closed set (or nobody can say how), which caps the status at tested.
 * @property {VerdictLocation} [location]     Required when changed.
 * @property {unknown} [input]                The failing input when a sample layer found the change (generated, never app data).
 * @property {string} sentence                One plain-English sentence (verdict.mjs verdictSentence).
 */

/**
 * A changed unit as the step view shows it.
 * @typedef {{unit: UnitRef, layer: VerifyLayer, location: VerdictLocation, input?: unknown, sentence: string}} Divergence
 */

/**
 * One checked step for the Cockpit step view and "How smart is it": "N proven, M tested, K unverified" plus the
 * divergences. Fixed-size apart from the divergences (one per changed unit).
 * @typedef {object} StepSummary
 * @property {string} step
 * @property {Record<VerdictStatus, number>} counts
 * @property {number} total
 * @property {Divergence[]} divergences
 * @property {string} sentence
 */

/** How the isolated runner called a unit: directly, under the headless hook harness, or with a generated event. */
/** @typedef {'function'|'hook'|'handler'} RunAs */

/**
 * One layer's answer for one unit.
 * @typedef {{layer: VerifyLayer, outcome: 'same-behaviour'|'changed'|'cant-tell'|'skipped', location?: VerdictLocation, input?: unknown, reason?: string, ms?: number, runAs?: RunAs}} LayerResult
 */

/** @typedef {'L0'|'L1'|'L2'|'L3'} EscalationLevel */

export const VERDICT_STATUSES = Object.freeze(/** @type {VerdictStatus[]} */ (['proven', 'tested', 'unverified', 'changed', 'not-extracted']));
export const PURITIES = Object.freeze(/** @type {Purity[]} */ (['pure', 'impure']));
export const VERIFY_LAYERS = Object.freeze(/** @type {VerifyLayer[]} */ (['L0-canonical', 'round-trip', 'semantic-diff', 'z3', 'fast-check', 'isolated', 'runtime', 'dev-server', 'browser', 'none']));
/**
 * How strong a layer's "same" is. proof: holds for every input (canonical form, round-trip, alpha-equivalent AST, an SMT
 * proof). sample: holds for the inputs that ran (property runs, isolated execution, recorded traces, a served page).
 */
export const LAYER_STRENGTH = Object.freeze(/** @type {Record<Exclude<VerifyLayer, 'none'>, 'proof'|'sample'>} */ ({
  'L0-canonical': 'proof', 'round-trip': 'proof', 'semantic-diff': 'proof', z3: 'proof',
  'fast-check': 'sample', isolated: 'sample', runtime: 'sample', 'dev-server': 'sample', browser: 'sample',
}));
/** Structural layers compare text, not behaviour: their mismatch means "changed" only for a claimed transform (Alive2-style). */
export const STRUCTURAL_LAYERS = Object.freeze(/** @type {VerifyLayer[]} */ (['L0-canonical', 'round-trip', 'semantic-diff']));
/** How each layer reads in a sentence. */
export const LAYER_WORDS = Object.freeze(/** @type {Record<VerifyLayer, string>} */ ({
  'L0-canonical': 'the canonical compare', 'round-trip': 'the extraction round-trip', 'semantic-diff': 'the semantic diff',
  z3: 'a Z3 proof', 'fast-check': 'fast-check property runs', isolated: 'isolated execution', runtime: 'runtime traces',
  'dev-server': 'the dev server', browser: 'the browser', none: 'no layer',
}));

/** The closed transform set (spec A): the only edits that can end in "proven". */
export const TRANSFORM_IDS = Object.freeze(/** @type {TransformId[]} */ (['move', 'rename', 'extract-function', 'extract-expression', 'wrap-adapter', 'repoint-imports', 'repoint-mocks']));
/** The existing Construct machinery each transform builds on (documentation data; step 3 validates against it). */
export const TRANSFORM_SOURCES = Object.freeze(/** @type {Record<TransformId, string>} */ ({
  move: 'packages/engine/tsFileMove.mjs planFileMove',
  rename: 'packages/engine/tsFileMove.mjs (construct refactor rename)',
  'extract-function': 'packages/engine/line/importV2/extract.mjs (line.import.extract*)',
  'extract-expression': 'packages/core/extractExpression.mjs',
  'wrap-adapter': 'packages/engine/line/importV2/extract.mjs (adapter wrap)',
  'repoint-imports': 'packages/engine/tsFileMove.mjs movedSpecifier',
  'repoint-mocks': 'packages/engine/tsFileMove.mjs callSpecifierEdits (CALL_SPECIFIER: jest.mock and require)',
}));

/** Effect names: Morpheus IMPORT_EFFECTS plus navigation, store, toast and analytics. */
export const EFFECT_NAMES = Object.freeze(/** @type {EffectName[]} */ (['fetch', 'storage', 'navigation', 'store', 'timer', 'toast', 'analytics', 'dom', 'random', 'time', 'console', 'mutation', 'throw']));
/** Morpheus contracts/importScan.ts IMPORT_EFFECTS, verbatim, and the name each one keeps here. */
export const MORPHEUS_EFFECTS = Object.freeze(/** @type {Record<string, EffectName>} */ ({
  fetch: 'fetch', dom: 'dom', storage: 'storage', timer: 'timer', random: 'random', time: 'time', console: 'console', mutation: 'mutation', throw: 'throw',
}));
/** Logic-map unit kinds that are effects, and their effect name (state and effect hooks are not effects by themselves). */
export const LOGIC_KIND_EFFECTS = Object.freeze(/** @type {Partial<Record<LogicUnitKind, EffectName>>} */ ({
  navigation: 'navigation', toast: 'toast', analytics: 'analytics', storage: 'storage', io: 'fetch', data: 'fetch',
}));
/** G2 RuntimeRecord kinds that are effects (graph/runtime/contract.mjs), and their effect name. */
export const RUNTIME_RECORD_EFFECTS = Object.freeze(/** @type {Record<string, EffectName>} */ ({ fetch: 'fetch', dispatch: 'store' }));

/** ast/semanticDiff SEMANTIC_DIFF_VERDICTS plus `skipped`. */
export const LAYER_OUTCOMES = Object.freeze(['same-behaviour', 'changed', 'cant-tell', 'skipped']);
export const RUN_AS = Object.freeze(/** @type {RunAs[]} */ (['function', 'hook', 'handler']));
/** ast/pureExportEquivalence verdict -> layer outcome. */
export const PURE_EQUIVALENCE_OUTCOME = Object.freeze({ equivalent: 'same-behaviour', diverged: 'changed', skipped: 'skipped', 'cant-tell': 'cant-tell' });

/** The escalation levels (spec F) and the layers each may run. */
export const ESCALATION_LEVELS = Object.freeze(/** @type {EscalationLevel[]} */ (['L0', 'L1', 'L2', 'L3']));
export const LEVEL_OF_LAYER = Object.freeze(/** @type {Record<Exclude<VerifyLayer, 'none'>, EscalationLevel>} */ ({
  'L0-canonical': 'L0', 'round-trip': 'L0', 'semantic-diff': 'L0', z3: 'L0', 'fast-check': 'L0',
  isolated: 'L1', runtime: 'L1', 'dev-server': 'L2', browser: 'L3',
}));

const FINGERPRINT = /^[0-9a-f]{16}$/;
/** `fn` then one or more `/<Type>.<key>` or `/<Type>.<key>[<i>]` segments (a last segment may be a bare `<Type>`). */
export const AST_PATH = /^(?:<module>|[A-Za-z_$][\w$.]*)(?:\/[A-Z][A-Za-z]*\.[A-Za-z]+(?:\[\d+\])?)*(?:\/[A-Z][A-Za-z]*(?:\.[A-Za-z]+(?:\[\d+\])?)?)$/;
const ITEM_ID = /^[^#\s]+#[^#\s]+$/;

// ---------------------------------------------------------------------------------------------
// Runtime shape checks. Each refusal is one sentence: "<where> must <what>."

const fail = (where, what) => { throw new TypeError(`${where} must ${what}.`); };
const str = (v, where) => { if (typeof v !== 'string' || v.length === 0) fail(where, 'be a non-empty string'); };
const sentence = (v, where) => { str(v, where); if (!/^\S[^\n]*[.?!]$/.test(v)) fail(where, 'be one sentence on one line ending in . ? or !'); };
const arr = (v, where) => { if (!Array.isArray(v)) fail(where, 'be an array'); };
const oneOf = (v, list, where) => { if (!list.includes(v)) fail(where, `be one of ${list.join(', ')}`); };
const int = (v, where, min = 0) => { if (!Number.isInteger(v) || v < min) fail(where, `be an integer from ${min}`); };
const relPath = (v, where) => { str(v, where); if (v.startsWith('/') || v.startsWith('..') || v.includes('\\')) fail(where, 'be an app-relative POSIX path'); };

/**
 * Throw a one-sentence TypeError unless `u` is a UnitRef (the G2 UnreachedUnit shape).
 * @param {any} u
 * @param {string} [where]
 * @returns {asserts u is UnitRef}
 */
export function assertUnitRef(u, where = 'The unit') {
  if (!u || typeof u !== 'object') fail(where, 'be an object');
  if (typeof u.fingerprint !== 'string' || !FINGERPRINT.test(u.fingerprint)) fail(`${where}'s fingerprint`, 'be the logic map fingerprint, 16 hex characters');
  str(u.id, `${where}'s id`);
  oneOf(u.kind, LOGIC_UNIT_KINDS, `${where}'s kind`);
  relPath(u.file, `${where}'s file`);
  str(u.fn, `${where}'s fn`);
  int(u.line, `${where}'s line`, 1);
}

/**
 * Throw a one-sentence TypeError unless `c` is an effect chain.
 * @param {any} c
 * @param {string} [where]
 * @returns {asserts c is EffectLink[]}
 */
export function assertEffectChain(c, where = 'The effect chain') {
  arr(c, where);
  const seen = new Set();
  c.forEach((l, i) => {
    oneOf(l?.effect, EFFECT_NAMES, `${where}'s link ${i} effect`);
    if (seen.has(l.effect)) fail(`${where}'s effect ${l.effect}`, 'appear once (its first site)');
    seen.add(l.effect);
    arr(l.via, `${where}'s link ${i} via`);
    l.via.forEach((id, j) => { if (typeof id !== 'string' || !ITEM_ID.test(id)) fail(`${where}'s link ${i} via[${j}]`, 'be a Morpheus item id like src/api.ts#saveOrder'); });
  });
}

/**
 * Throw a one-sentence TypeError unless `l` is a VerdictLocation.
 * @param {any} l
 * @param {string} [where]
 * @returns {asserts l is VerdictLocation}
 */
export function assertVerdictLocation(l, where = 'The location') {
  if (!l || typeof l !== 'object') fail(where, 'be an object');
  if (typeof l.astPath !== 'string' || !AST_PATH.test(l.astPath)) fail(`${where}'s astPath`, 'be fn/<Type>.<key>[i]/... starting at the enclosing function');
  relPath(l.file, `${where}'s file`);
  int(l.line, `${where}'s line`, 1);
  if (l.column !== undefined) int(l.column, `${where}'s column`, 1);
  if (l.side !== undefined) oneOf(l.side, ['before', 'after'], `${where}'s side`);
}

/**
 * True when every id is in the closed transform set (an empty list, an untouched unit, qualifies).
 * @param {unknown} transforms
 * @returns {boolean}
 */
export function inClosedSet(transforms) {
  return Array.isArray(transforms) && transforms.every((t) => TRANSFORM_IDS.includes(t));
}

/**
 * Throw a one-sentence TypeError unless `v` is a UnitVerdict. Enforces: pure exactly when the chain is empty; changed
 * carries a location; proven only for closed-set transforms decided by a proof layer; not-extracted only from the
 * round-trip; unverified is never decided by a "same".
 * @param {any} v
 * @param {string} [where]
 * @returns {asserts v is UnitVerdict}
 */
export function assertUnitVerdict(v, where = 'The unit verdict') {
  if (!v || typeof v !== 'object') fail(where, 'be an object');
  assertUnitRef(v.unit, `${where}'s unit`);
  oneOf(v.purity, PURITIES, `${where}'s purity`);
  assertEffectChain(v.effectChain, `${where}'s effectChain`);
  if ((v.purity === 'pure') !== (v.effectChain.length === 0)) fail(`${where}'s purity`, `be ${v.effectChain.length ? 'impure, because its effect chain is not empty' : 'pure, because its effect chain is empty'}`);
  oneOf(v.status, VERDICT_STATUSES, `${where}'s status`);
  oneOf(v.layer, VERIFY_LAYERS, `${where}'s layer`);
  if (v.transforms !== null) {
    arr(v.transforms, `${where}'s transforms`);
    v.transforms.forEach((t, i) => oneOf(t, TRANSFORM_IDS, `${where}'s transforms[${i}]`));
  }
  if (v.location !== undefined) assertVerdictLocation(v.location, `${where}'s location`);
  if (v.status === 'changed') {
    if (v.location === undefined) fail(`${where}'s location`, 'be given, because a changed unit names its exact location');
    if (v.layer === 'none') fail(`${where}'s layer`, 'name the layer that found the change');
  }
  if (v.status === 'proven') {
    if (!inClosedSet(v.transforms)) fail(`${where}'s status`, 'not be proven, because the unit was edited outside the closed transform set');
    if (v.layer === 'none' || LAYER_STRENGTH[v.layer] !== 'proof') fail(`${where}'s status`, `not be proven by ${LAYER_WORDS[v.layer]}, which only samples inputs`);
  }
  if (v.status === 'tested' && v.layer === 'none') fail(`${where}'s layer`, 'name the layer that tested it');
  if (v.status === 'not-extracted' && v.layer !== 'round-trip') fail(`${where}'s layer`, 'be round-trip for a unit that is not extracted');
  if (v.input !== undefined && v.status !== 'changed') fail(`${where}'s input`, 'be given only for a changed unit');
  sentence(v.sentence, `${where}'s sentence`);
}

/**
 * Throw a one-sentence TypeError unless `r` is a LayerResult.
 * @param {any} r
 * @param {string} [where]
 * @returns {asserts r is LayerResult}
 */
export function assertLayerResult(r, where = 'The layer result') {
  if (!r || typeof r !== 'object') fail(where, 'be an object');
  oneOf(r.layer, VERIFY_LAYERS.filter((l) => l !== 'none'), `${where}'s layer`);
  oneOf(r.outcome, LAYER_OUTCOMES, `${where}'s outcome`);
  if (r.location !== undefined) assertVerdictLocation(r.location, `${where}'s location`);
  if (r.ms !== undefined && !(typeof r.ms === 'number' && r.ms >= 0)) fail(`${where}'s ms`, 'be a non-negative number');
  if (r.runAs !== undefined) oneOf(r.runAs, RUN_AS, `${where}'s runAs`);
}

/**
 * Throw a one-sentence TypeError unless `s` is a StepSummary whose counts add up and whose divergences are exactly its
 * changed units.
 * @param {any} s
 * @returns {asserts s is StepSummary}
 */
export function assertStepSummary(s) {
  if (!s || typeof s !== 'object') fail('The step summary', 'be an object');
  str(s.step, "The step summary's step");
  if (!s.counts || typeof s.counts !== 'object') fail("The step summary's counts", 'be an object');
  let sum = 0;
  for (const k of VERDICT_STATUSES) { int(s.counts[k], `The step summary's ${k} count`); sum += s.counts[k]; }
  int(s.total, "The step summary's total");
  if (sum !== s.total) fail("The step summary's total", `equal the sum of its counts, ${sum}`);
  arr(s.divergences, "The step summary's divergences");
  if (s.divergences.length !== s.counts.changed) fail("The step summary's divergences", `list each of its ${s.counts.changed} changed units`);
  s.divergences.forEach((d, i) => {
    assertUnitRef(d?.unit, `Divergence ${i}'s unit`);
    oneOf(d.layer, VERIFY_LAYERS.filter((l) => l !== 'none'), `Divergence ${i}'s layer`);
    assertVerdictLocation(d.location, `Divergence ${i}'s location`);
    sentence(d.sentence, `Divergence ${i}'s sentence`);
  });
  sentence(s.sentence, "The step summary's sentence");
}
