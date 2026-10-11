// Line Import v2 contract: the shapes every Import v2 branch builds against (docs/line/import-v2/CONTRACT.md).
// No logic lives here except the runtime shape checks, which the real implementations and the mock (mock.mjs)
// both pass in test/line-import-v2-contract.test.mjs. Change a shape here first, then its users.
//
//   iv2-map    buildLogicMap, compareLogicMaps          packages/engine/line/logicMap.mjs
//   iv2-tests  characterizer, coverage -> unit mapping  (CharTest, UnitCoverage)
//   iv2-fit    readRouteFamily, fitLogic                (RouteClosure, FitProposal)
//   iv2-loop   importAgent stages map/characterize      (ImportLoopState)
//
// Every assert* throws a TypeError whose message is one plain-English sentence naming the bad field.

/**
 * What a logic unit is: one decision, effect, data call, navigation, handler or export in the app's code.
 * @typedef {'branch'|'render-if'|'state'|'effect'|'derived'|'data'|'navigation'|'url-read'|'handler'|'toast'|'analytics'|'storage'|'io'|'export'} LogicUnitKind
 */

/**
 * One unit of existing logic that an import must keep.
 * @typedef {object} LogicUnit
 * @property {string} id           "file#fn:kind:n", for display only (it changes when the file moves).
 * @property {string} fingerprint  Stable hash of kind + enclosing function name + normalized AST text; never the file path.
 * @property {LogicUnitKind} kind
 * @property {string} file         App-root-relative POSIX path.
 * @property {string} fn           Enclosing named function, or "<module>".
 * @property {number} line         1-based.
 * @property {string} detail       Short readable text of the unit (at most 140 characters).
 * @property {string} [anchor]     The normalized AST text the fingerprint was hashed from (optional; lets
 *                                 compareLogicMaps re-hash through a rename table given after the map was built).
 */

/**
 * A route family's logic, unit by unit.
 * @typedef {object} LogicMap
 * @property {string} root                          The app root the files are relative to.
 * @property {string[]} files                       App-root-relative files that were mapped.
 * @property {LogicUnit[]} units
 * @property {Partial<Record<LogicUnitKind, number>>} counts  Units per kind (sums to units.length).
 */

/**
 * A unit whose logic changed between two maps, with the sentence a person reads.
 * @typedef {object} ChangedUnit
 * @property {LogicUnit} before
 * @property {LogicUnit} after
 * @property {string} sentence
 */

/**
 * A missing unit plus the one sentence that says what was lost.
 * @typedef {LogicUnit & {sentence: string}} MissingUnit
 */

/**
 * The difference between the map before an import step and the map after it.
 * @typedef {object} MapDiff
 * @property {LogicUnit[]} kept                       Same fingerprint, same file.
 * @property {{from: LogicUnit, to: LogicUnit}[]} moved  Same fingerprint, different file.
 * @property {MissingUnit[]} missing                  In before, nowhere in after; each has one sentence.
 * @property {ChangedUnit[]} changed                  Same place (fn + kind + order) but different logic.
 * @property {LogicUnit[]} added                      In after only.
 */

/**
 * The files a route family reaches, and where the tracer stopped.
 * @typedef {object} RouteClosure
 * @property {string} appRoot
 * @property {{route: string, entry: string}[]} routes  The route and its sub-routes, each with its entry file.
 * @property {string[]} files                           App-root-relative files in the closure.
 * @property {string[]} external                        Boundaries the tracer stopped at (packages, excluded folders).
 */

/** @typedef {'pure'|'render'|'interaction'|'machine'} CharTestKind */

/**
 * One characterization test written in the target app's own runner.
 * @typedef {object} CharTest
 * @property {string} file                 App-root-relative test file.
 * @property {'jest'} runner
 * @property {CharTestKind} kind
 * @property {string[]} unitFingerprints   The units this test pins.
 * @property {string} title
 */

/**
 * Which units the characterization tests cover.
 * @typedef {object} UnitCoverage
 * @property {string[]} covered     Fingerprints.
 * @property {string[]} uncovered   Fingerprints.
 * @property {{fingerprint: string, by: 'owner', why: string}[]} waived
 */

/** @typedef {'page'|'component'|'workflow'|'fixture'|'usecase'|'service'|'domain'} FitBlockKind */

/**
 * One Line block the import proposes, with the units it takes.
 * @typedef {object} FitBlock
 * @property {FitBlockKind} kind
 * @property {string} name
 * @property {string[]} units     Fingerprints; each fingerprint sits in exactly one block.
 * @property {string[]} from      App-root-relative source files.
 * @property {string} sentence    Why these units fit this block, in plain English.
 */

/**
 * Where every unit of a feature goes.
 * @typedef {object} FitProposal
 * @property {string} feature
 * @property {FitBlock[]} blocks
 * @property {string[]} unassigned  Fingerprints no rule placed.
 */

/** @typedef {'read'|'map'|'characterize'|'plan'|'execute'|'verify'} ImportLoopStep */

/**
 * One round of the Import v2 loop.
 * @typedef {object} ImportLoopState
 * @property {ImportLoopStep} step
 * @property {LogicMap|null} mapBefore
 * @property {LogicMap|null} mapAfter
 * @property {MapDiff|null} diff
 * @property {{passed: number, failed: number}} tests
 * @property {UnitCoverage|null} coverage
 * @property {'ok'|'stopped'} status
 * @property {string} sentence
 */

export const LOGIC_UNIT_KINDS = Object.freeze(['branch', 'render-if', 'state', 'effect', 'derived', 'data', 'navigation', 'url-read', 'handler', 'toast', 'analytics', 'storage', 'io', 'export']);
export const CHAR_TEST_KINDS = Object.freeze(['pure', 'render', 'interaction', 'machine']);
export const FIT_BLOCK_KINDS = Object.freeze(['page', 'component', 'workflow', 'fixture', 'usecase', 'service', 'domain']);
export const IMPORT_LOOP_STEPS = Object.freeze(['read', 'map', 'characterize', 'plan', 'execute', 'verify']);
/** Where a LogicMap is stored, relative to the Line folder (written through writeLineState). */
export const LOGIC_MAP_FILE = 'line/logic-map.json';

// ---------------------------------------------------------------------------------------------
// Runtime shape checks. Each refusal is one sentence: "<where> must <what>."

const fail = (where, what) => { throw new TypeError(`${where} must ${what}.`); };
const str = (v, where) => { if (typeof v !== 'string' || v.length === 0) fail(where, 'be a non-empty string'); };
const sentence = (v, where) => { str(v, where); if (!/^\S.*[.?!]$/s.test(v)) fail(where, 'be a full sentence ending in . ? or !'); };
const arr = (v, where) => { if (!Array.isArray(v)) fail(where, 'be an array'); };
const strs = (v, where) => { arr(v, where); v.forEach((s, i) => str(s, `${where}[${i}]`)); };
const oneOf = (v, list, where) => { if (!list.includes(v)) fail(where, `be one of ${list.join(', ')}`); };
const int = (v, where, min = 0) => { if (!Number.isInteger(v) || v < min) fail(where, `be an integer from ${min}`); };

/**
 * Throw a one-sentence TypeError unless `u` is a LogicUnit.
 * @param {any} u The value to check.
 * @param {string} [where] Where it sits, for the error message.
 * @returns {asserts u is LogicUnit}
 */
export function assertLogicUnit(u, where = 'The logic unit') {
  if (!u || typeof u !== 'object') fail(where, 'be an object');
  str(u.id, `${where}'s id`);
  str(u.fingerprint, `${where}'s fingerprint`);
  oneOf(u.kind, LOGIC_UNIT_KINDS, `${where}'s kind`);
  str(u.file, `${where}'s file`);
  str(u.fn, `${where}'s fn`);
  int(u.line, `${where}'s line`, 1);
  if (typeof u.detail !== 'string') fail(`${where}'s detail`, 'be a string');
}

/**
 * Throw a one-sentence TypeError unless `m` is a LogicMap whose counts match its units.
 * @param {any} m The value to check.
 * @returns {asserts m is LogicMap}
 */
export function assertLogicMap(m) {
  if (!m || typeof m !== 'object') fail('The logic map', 'be an object');
  str(m.root, "The logic map's root");
  strs(m.files, "The logic map's files");
  arr(m.units, "The logic map's units");
  m.units.forEach((u, i) => assertLogicUnit(u, `Logic map unit ${i}`));
  const fps = new Set();
  for (const u of m.units) {
    if (fps.has(u.fingerprint)) fail(`The fingerprint ${u.fingerprint} of ${u.id}`, 'be unique within the map');
    fps.add(u.fingerprint);
  }
  if (!m.counts || typeof m.counts !== 'object') fail("The logic map's counts", 'be an object');
  for (const k of LOGIC_UNIT_KINDS) {
    const n = m.units.filter((u) => u.kind === k).length;
    if ((m.counts[k] ?? 0) !== n) fail(`The logic map's count for ${k}`, `equal its ${n} units`);
  }
}

/**
 * Throw a one-sentence TypeError unless `d` is a MapDiff; every missing and changed unit carries a sentence.
 * @param {any} d The value to check.
 * @returns {asserts d is MapDiff}
 */
export function assertMapDiff(d) {
  if (!d || typeof d !== 'object') fail('The map diff', 'be an object');
  for (const k of ['kept', 'moved', 'missing', 'changed', 'added']) arr(d[k], `The map diff's ${k}`);
  d.kept.forEach((u, i) => assertLogicUnit(u, `Kept unit ${i}`));
  d.added.forEach((u, i) => assertLogicUnit(u, `Added unit ${i}`));
  d.moved.forEach((m, i) => { assertLogicUnit(m?.from, `Moved unit ${i}'s from`); assertLogicUnit(m.to, `Moved unit ${i}'s to`); });
  d.missing.forEach((/** @type {any} */ u, i) => { sentence(u?.sentence, `Missing unit ${i}'s sentence`); assertLogicUnit(u, `Missing unit ${i}`); });
  d.changed.forEach((c, i) => {
    assertLogicUnit(c?.before, `Changed unit ${i}'s before`);
    assertLogicUnit(c.after, `Changed unit ${i}'s after`);
    sentence(c.sentence, `Changed unit ${i}'s sentence`);
  });
}

/**
 * Throw a one-sentence TypeError unless `c` is a RouteClosure.
 * @param {any} c The value to check.
 * @returns {asserts c is RouteClosure}
 */
export function assertRouteClosure(c) {
  if (!c || typeof c !== 'object') fail('The route closure', 'be an object');
  str(c.appRoot, "The route closure's appRoot");
  arr(c.routes, "The route closure's routes");
  if (c.routes.length === 0) fail("The route closure's routes", 'name at least one route');
  c.routes.forEach((r, i) => { str(r?.route, `Route ${i}'s route`); str(r.entry, `Route ${i}'s entry`); });
  strs(c.files, "The route closure's files");
  strs(c.external, "The route closure's external");
}

/**
 * Throw a one-sentence TypeError unless `t` is a CharTest.
 * @param {any} t The value to check.
 * @param {string} [where] Where it sits, for the error message.
 * @returns {asserts t is CharTest}
 */
export function assertCharTest(t, where = 'The characterization test') {
  if (!t || typeof t !== 'object') fail(where, 'be an object');
  str(t.file, `${where}'s file`);
  if (t.runner !== 'jest') fail(`${where}'s runner`, 'be jest');
  oneOf(t.kind, CHAR_TEST_KINDS, `${where}'s kind`);
  strs(t.unitFingerprints, `${where}'s unitFingerprints`);
  if (t.unitFingerprints.length === 0) fail(`${where}'s unitFingerprints`, 'name at least one unit');
  str(t.title, `${where}'s title`);
}

/**
 * Throw a one-sentence TypeError unless `c` is a UnitCoverage with no fingerprint in two buckets.
 * @param {any} c The value to check.
 * @returns {asserts c is UnitCoverage}
 */
export function assertUnitCoverage(c) {
  if (!c || typeof c !== 'object') fail('The unit coverage', 'be an object');
  strs(c.covered, "The unit coverage's covered");
  strs(c.uncovered, "The unit coverage's uncovered");
  arr(c.waived, "The unit coverage's waived");
  c.waived.forEach((w, i) => {
    str(w?.fingerprint, `Waiver ${i}'s fingerprint`);
    if (w.by !== 'owner') fail(`Waiver ${i}'s by`, 'be owner');
    sentence(w.why, `Waiver ${i}'s why`);
  });
  const seen = new Set();
  for (const fp of [...c.covered, ...c.uncovered, ...c.waived.map((w) => w.fingerprint)]) {
    if (seen.has(fp)) fail(`The fingerprint ${fp}`, 'sit in only one of covered, uncovered and waived');
    seen.add(fp);
  }
}

/**
 * Throw a one-sentence TypeError unless `p` is a FitProposal in which every unit sits in exactly one place.
 * @param {any} p The value to check.
 * @returns {asserts p is FitProposal}
 */
export function assertFitProposal(p) {
  if (!p || typeof p !== 'object') fail('The fit proposal', 'be an object');
  str(p.feature, "The fit proposal's feature");
  arr(p.blocks, "The fit proposal's blocks");
  strs(p.unassigned, "The fit proposal's unassigned");
  const seen = new Set(p.unassigned);
  p.blocks.forEach((b, i) => {
    const w = `Fit block ${i}`;
    oneOf(b?.kind, FIT_BLOCK_KINDS, `${w}'s kind`);
    str(b.name, `${w}'s name`);
    strs(b.units, `${w}'s units`);
    strs(b.from, `${w}'s from`);
    sentence(b.sentence, `${w}'s sentence`);
    for (const fp of b.units) {
      if (seen.has(fp)) fail(`The unit ${fp}`, 'go to exactly one block');
      seen.add(fp);
    }
  });
}

/**
 * Throw a one-sentence TypeError unless `s` is an ImportLoopState.
 * @param {any} s The value to check.
 * @returns {asserts s is ImportLoopState}
 */
export function assertImportLoopState(s) {
  if (!s || typeof s !== 'object') fail('The import loop state', 'be an object');
  oneOf(s.step, IMPORT_LOOP_STEPS, "The import loop state's step");
  if (s.mapBefore !== null) assertLogicMap(s.mapBefore);
  if (s.mapAfter !== null) assertLogicMap(s.mapAfter);
  if (s.diff !== null) assertMapDiff(s.diff);
  int(s.tests?.passed, "The import loop state's tests.passed");
  int(s.tests.failed, "The import loop state's tests.failed");
  if (s.coverage !== null) assertUnitCoverage(s.coverage);
  oneOf(s.status, ['ok', 'stopped'], "The import loop state's status");
  sentence(s.sentence, "The import loop state's sentence");
}
