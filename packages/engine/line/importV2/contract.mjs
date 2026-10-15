// Line Import v2 contract: the ONE place the Import v2 shapes live (docs/line/import-v2/CONTRACT.md). No logic lives
// here except the runtime shape checks, which the real implementations and the mock (mock.mjs) both pass in
// test/line-import-v2-contract.test.mjs. Change a shape here first, then its users. Pure: no imports, so Cockpit's mock
// mode (the browser) reads it too.
//
//   logicMap.mjs + importV2/compare.mjs   buildLogicMap, compareLogicMaps        (LogicUnit, LogicMap, MapDiff)
//   characterize.mjs                      characterize, unitCoverage             (CharTest, UnitCoverage)
//   importV2/route.mjs, importV2/fit.mjs  readRouteFamily, fitLogic, planFitSteps (RouteClosure, FitProposal, FitStep)
//   importLoop.mjs                        the loop's checks and records          (ImportLoopState, ImportLogic, UnitWaiver)
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
 * @property {string} [exportName] Export units only: the exported binding name(s) ("Button", "a, b", "default"), for
 *                                 labels; `fn` stays "<module>" because fingerprints key on it.
 * @property {string} [anchor]     The normalized AST text the fingerprint was hashed from (optional; lets
 *                                 compareLogicMaps re-hash through a rename table given after the map was built).
 * @property {'pure'|'impure'} [purity]  The enclosing function's purity class (buildLogicMap `classify`; #861).
 * @property {string[]} [effects]  Its effect names (logicVerify/purity.mjs classifyFile); the chain length is the count.
 * @property {ComplexitySignature} [complexity]  The enclosing named function's complexity (#923; @construct/ast functionComplexity).
 */

/**
 * A function's complexity signature (#923): the counting rules are in packages/ast/functionComplexity.mjs's header.
 * Cyclomatic is ESLint's `complexity` rule; cognitive is fallow's, null until fallow's results are given.
 * @typedef {{cyclomatic: number, cognitive: number|null, maxNesting: number, params: number, returns: number}} ComplexitySignature
 */

/**
 * How one function's complexity moved between two maps (#923).
 * @typedef {object} ComplexityDelta
 * @property {string} file  The after-side file.
 * @property {string} fn    The after-side function name.
 * @property {ComplexitySignature} before
 * @property {ComplexitySignature} after
 * @property {{[K in keyof ComplexitySignature]: number|null}} delta  after minus before, per field (null where a side has no number).
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
 * @property {ComplexityDelta[]} [complexity]          Functions whose complexity signature changed, one entry per function.
 */

/**
 * The files a route family reaches, and where the tracer stopped.
 * @typedef {object} RouteClosure
 * @property {string} appRoot
 * @property {{route: string, entry: string}[]} routes  The route and its sub-routes (or several routes' families,
 *   one feature), each with its entry file.
 * @property {string} [feature]                         The feature the family becomes: the person's name, else the
 *   first route's family name.
 * @property {string[]} files                           App-root-relative files only this family reaches: the feature.
 *   They are imported, mapped, characterized and fitted.
 * @property {string[]} shared                          App-root-relative files the family reaches that a root outside
 *   it (another route, a layout, middleware) reaches too: they stay where they are and are referenced, never imported,
 *   mapped, characterized or fitted.
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
 * An owner's waiver of one unit (or `test:<file>` / `file:<path>` for a test or a file's behaviour). Only a person
 * waives; an agent never can.
 * @typedef {object} UnitWaiver
 * @property {string} fingerprint
 * @property {'owner'} by
 * @property {string} why   One sentence.
 * @property {string} [at]  ISO time.
 */

/**
 * Which units the characterization tests cover (characterize.mjs unitCoverage).
 * @typedef {object} UnitCoverage
 * @property {string[]} covered     Fingerprints.
 * @property {string[]} uncovered   Fingerprints (not waived).
 * @property {UnitWaiver[]} waived
 * @property {Record<string, {covered: number, total: number}>} [byKind]  Per unit kind (iv2-tests).
 * @property {{fingerprint: string, id: string, kind: string, file: string, line: number, cause: string, why: string}[]} [details]
 *   Each uncovered unit with its reason in one sentence (iv2-tests causeOf).
 */

/** @typedef {'page'|'component'|'workflow'|'fixture'|'usecase'|'service'|'domain'} FitBlockKind */

/**
 * One Line block the import proposes, with the units it takes.
 * @typedef {object} FitBlock
 * @property {FitBlockKind} kind
 * @property {string} name
 * @property {string[]} units     Unit keys (the fingerprint, else the id); each sits in exactly one block.
 * @property {string[]} from      Where the code is now: `file#name` (a top-level declaration) or `file` (the whole file), app-relative.
 * @property {string} sentence    Why these units fit this block, in plain English.
 * @property {'feature'|'library'} [area]  The library when other routes use the code too (iv2-fit), else the feature.
 */

/**
 * Where every unit of a feature goes. A unit no fitting rule claims is listed with one sentence, for a person to place.
 * @typedef {object} FitProposal
 * @property {string} feature
 * @property {FitBlock[]} blocks
 * @property {{unit: string, sentence: string}[]} unassigned
 */

/**
 * One plan step planFitSteps proposes: a line.import.extract* tool (or splitPage) with its args.
 * @typedef {object} FitStep
 * @property {string} id
 * @property {'line.import.extractService'|'line.import.extractDomain'|'line.import.extractUsecase'|'line.import.extractWorkflow'|'line.import.splitPage'} tool
 * @property {Record<string, unknown>} args  Always holds `folder`; paths inside args are folder-relative.
 * @property {string} sentence
 * @property {string[]} blocks  The proposal blocks (`kind:name`) this step lands.
 */

/**
 * The fixed-size reference to a logic map a loop record keeps instead of the whole map.
 * @typedef {{units: number, counts: Partial<Record<LogicUnitKind, number>>, hash: string}} MapSummary
 */

/** @typedef {{covered: number, uncovered: number, waived: number, total: number}} UnitCoverageCounts */

/**
 * One checked import step (importLoop.mjs loopState): the maps by reference, the diff as counts plus the first missing
 * units, the tests, the coverage as counts, and `ok` or `stopped` with ONE sentence and the typed fixes. Fixed-size, so
 * it fits the import plan file and the plan records (`records/import-loop.jsonl`).
 * @typedef {object} ImportLoopState
 * @property {string} step         The import step's id (or `verify`).
 * @property {number} n
 * @property {string} at           ISO time.
 * @property {string} tool
 * @property {MapSummary|null} mapBefore
 * @property {MapSummary} mapAfter
 * @property {{kept: number, moved: number, added: number, changed: number, missingCount: number, missing: any[]}} diff
 * @property {{passed: number, failed: number, total: number, state: string}} tests
 * @property {UnitCoverageCounts} coverage
 * @property {{from: string, to: string, verdict: string}[]} behaviour
 * @property {{id: string, state: string, sentence: string}[]} checks
 * @property {'ok'|'stopped'} status
 * @property {string} sentence
 * @property {any[]} fixes          Typed fixes: `put-back` (with `step`, the extract tool of the unit's block, when one fits), `recheck`, `waive` (owner only).
 */

/**
 * The import plan file's loop record (contract.mjs ImportPlanFile.logic).
 * @typedef {object} ImportLogic
 * @property {string|string[]|null} route  One route, or several routes that make one feature together.
 * @property {string} [feature]             The person's name for the feature (default the first route's family name).
 * @property {{routes: {route: string, entry: string}[], feature?: string, files: string[], shared?: string[], external: string[]}|null} closure
 * @property {MapSummary|null} map            The baseline (the full map is LOGIC_MAP_FILE).
 * @property {{feature: string, blocks: number, unassigned: number, sentence: string}|null} [fit]  The FitProposal (full one: FIT_FILE).
 * @property {CharTest[]} tests
 * @property {any} baselineTests
 * @property {UnitWaiver[]} waivers
 * @property {ImportLoopState[]} loop
 * @property {any} last
 * @property {any} [pending]
 * @property {AtomBreakdownSummary|null} [atoms]  The static breakdown into atoms (full one: ATOMS_FILE).
 */

/**
 * Static breakdown (importV2/breakdown.mjs): one pure function of a domain block, rewritten into calls of the atom
 * runtime by atomic-codemod's toAtoms and checked by running old and new on the same generated inputs in QuickJS. A
 * rewrite counts only when the check says `same`; one that changes behaviour is taken back.
 * @typedef {object} AtomUnitResult
 * @property {string} file          App-relative.
 * @property {string} name          The top-level function.
 * @property {string} block         The FitProposal block, `domain:<name>`.
 * @property {'converted'|'partial'|'unchanged'|'unchecked'} status
 *   converted: every part is an atom call and the check says same; partial: the check says same but some parts have no
 *   atom (they arrive at construct.repair as a refusal); unchanged: nothing to rewrite; unchecked: the check could not
 *   run it, so no rewrite counts and the original stays.
 * @property {{status: 'same'|'different'|'unchecked', runs: number, compared: number, exercised: number, mismatchCount: number, why?: string}} check
 * @property {string[]} atoms        The atoms the kept body calls.
 * @property {number} rewrites       Rewrites kept (checked).
 * @property {number} takenBack      Rewrites the check took back.
 * @property {string} code           The original function (a declaration).
 * @property {string} body           The kept function: the rewrite when it counts, else `code`.
 * @property {string} importDecl     The import of the atoms `body` calls, from ATOMS_PACKAGE ('' when none).
 * @property {{form: string, text: string, line: number, reason?: string}[]} untranslated  Parts with no atom.
 * @property {{outcome: string, sentence: string} } [repair]  construct.repair's answer to the refusal, when it was asked.
 * @property {{file: string, sentence: string}} [written]  The line.import.writeAtoms step wrote `body` into `file` and its
 *   behaviour test passed (the function as written behaves as `code`); only a converted unit is written.
 * @property {EnglishView} [english]  The read-only English view of `body` as written (ENGLISH-RULES step 6), set with
 *   `written`; generated, never edited.
 * @property {string} sentence
 */

/**
 * The read-only English view of one written function (importV2/englishView.mjs, fluent plan T2.4): every atom call of
 * the function as its fluent sentence, innermost first. The app keeps its typed code; this view is generated from it.
 * @typedef {object} EnglishView
 * @property {'fluent'|'off'} via    `off`: the fluent writer or the catalog is not set up, so there is no view.
 * @property {string} code           The function with each atom call that has a sentence replaced by it ('' when off).
 * @property {{atom: string, sentence: string}[]} sentences  One per atom call written as a sentence, innermost first.
 * @property {number} plain          Atom calls that stay as code (one entry each in `reasons`).
 * @property {{atom: string, reason: string}[]} reasons
 * @property {boolean} full          Every atom call is a sentence, and there is at least one.
 * @property {string} [reason]       Why it is off.
 * @property {string} sentence
 */

/**
 * @typedef {object} AtomBreakdown
 * @property {'static'|'off'} via    `off`: the codemod or the runtime is not linked, so nothing was broken down.
 * @property {string|null} codemod   The linked atomic-codemod commit.
 * @property {string|null} runtime   The atom runtime commit.
 * @property {AtomUnitResult[]} units
 * @property {AtomBreakdownCounts} counts
 * @property {string} sentence
 * @property {string} [reason]       Why it is off.
 */

/**
 * @typedef {{functions: number, converted: number, partial: number, unchanged: number, unchecked: number, rewrites: number, takenBack: number, refused: number, repaired: number}} AtomBreakdownCounts
 * @typedef {AtomBreakdownCounts & {via: 'static'|'off', sentence: string}} AtomBreakdownSummary
 */

export const LOGIC_UNIT_KINDS = Object.freeze(['branch', 'render-if', 'state', 'effect', 'derived', 'data', 'navigation', 'url-read', 'handler', 'toast', 'analytics', 'storage', 'io', 'export']);
/** How each unit kind reads in a sentence. */
export const LOGIC_UNIT_WORDS = Object.freeze(/** @type {Record<LogicUnitKind, string>} */ ({
  branch: 'branch', 'render-if': 'conditional render', state: 'state', effect: 'effect', derived: 'derived value', data: 'data call',
  navigation: 'navigation', 'url-read': 'URL read', handler: 'event handler', toast: 'toast', analytics: 'analytics call', storage: 'storage call', io: 'network call', export: 'export',
}));
export const CHAR_TEST_KINDS = Object.freeze(['pure', 'render', 'interaction', 'machine']);
/** The block kinds, in fitting-rule order (CONTRACT.md "Fit": service, domain, usecase, workflow, component/page, fixture). */
export const FIT_BLOCK_KINDS = Object.freeze(['service', 'domain', 'usecase', 'workflow', 'component', 'page', 'fixture']);
/** The Line folder each block kind lands in. */
export const KIND_FOLDER = Object.freeze({ page: 'pages', component: 'components', workflow: 'workflows', fixture: 'fixtures', usecase: 'usecases', service: 'services', domain: 'domains' });
/** Where a LogicMap is stored, relative to the Line folder (written through writeLineState). */
export const LOGIC_MAP_FILE = 'line/logic-map.json';
/** Where the FitProposal is stored, relative to the Line folder. */
export const FIT_FILE = 'line/fit.json';
/** The import loop's records, under Line's state folder (one ImportLoopState per line, slotted). */
/** Where the static breakdown into atoms is kept, in the folder (AtomBreakdown). */
export const ATOMS_FILE = 'line/atoms.json';
/** The status of one function's breakdown. */
export const ATOM_UNIT_STATUS = Object.freeze(['converted', 'partial', 'unchanged', 'unchecked']);
/** The refusal shape's tool name for a function's atom rewrite (checked by the breakdown's own check, never run as a plan step). */
export const ATOMS_TOOL = 'line.import.atoms';
/** The package an app imports the atoms from (owner, 2026-10-14: through @line/atoms; an app's tsconfig aliases it to its copy). */
export const ATOMS_PACKAGE = '@line/atoms';
/** The plan step that writes one converted function into its app file (importV2/writeAtoms.mjs). */
export const ATOMS_WRITE_TOOL = 'line.import.writeAtoms';
export const IMPORT_LOOP_RECORDS = 'records/import-loop.jsonl';

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
 * A route spec (one route or several) in words: "/orders", or "/ and /profile/:id".
 * @param {string|string[]|null|undefined} route
 * @returns {string}
 */
export function routeLabel(route) {
  const list = (Array.isArray(route) ? route : [route]).filter(Boolean).map(String);
  return list.length < 3 ? list.join(' and ') : `${list.slice(0, -1).join(', ')} and ${list.at(-1)}`;
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
  c.files.forEach((f, i) => { if (f.startsWith('/') || f.startsWith('..')) fail(`The route closure's file ${i}`, 'be app-relative'); });
  strs(c.shared, "The route closure's shared");
  const own = new Set(c.files);
  c.shared.forEach((f, i) => {
    if (f.startsWith('/') || f.startsWith('..')) fail(`The route closure's shared file ${i}`, 'be app-relative');
    if (own.has(f)) fail(`The route closure's shared file ${f}`, 'not be one of its files too');
  });
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
 * Throw a one-sentence TypeError unless `w` is an owner's waiver.
 * @param {any} w The value to check.
 * @param {string} [where] Where it sits, for the error message.
 * @returns {asserts w is UnitWaiver}
 */
export function assertUnitWaiver(w, where = 'The waiver') {
  if (!w || typeof w !== 'object') fail(where, 'be an object');
  str(w.fingerprint, `${where}'s fingerprint`);
  if (w.by !== 'owner') fail(`${where}'s by`, 'be owner, because an agent never waives');
  sentence(w.why, `${where}'s why`);
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
  c.waived.forEach((w, i) => assertUnitWaiver(w, `Waiver ${i}`));
  const seen = new Set();
  for (const fp of [...c.covered, ...c.uncovered, ...c.waived.map((w) => w.fingerprint)]) {
    if (seen.has(fp)) fail(`The fingerprint ${fp}`, 'sit in only one of covered, uncovered and waived');
    seen.add(fp);
  }
  if (c.byKind !== undefined) {
    if (!c.byKind || typeof c.byKind !== 'object') fail("The unit coverage's byKind", 'be an object');
    for (const [k, v] of Object.entries(c.byKind)) {
      oneOf(k, LOGIC_UNIT_KINDS, "A byKind key of the unit coverage");
      int(v?.covered, `The unit coverage's byKind.${k}.covered`);
      int(v.total, `The unit coverage's byKind.${k}.total`);
      if (v.covered > v.total) fail(`The unit coverage's byKind.${k}.covered`, 'be at most its total');
    }
  }
  if (c.details !== undefined) {
    arr(c.details, "The unit coverage's details");
    c.details.forEach((d, i) => { str(d?.fingerprint, `Coverage detail ${i}'s fingerprint`); str(d.cause, `Coverage detail ${i}'s cause`); sentence(d.why, `Coverage detail ${i}'s why`); });
  }
}

/**
 * Throw a one-sentence TypeError unless `p` is a FitProposal in which every unit sits in exactly one place (one block,
 * or listed as unassigned with a sentence), and block names are unique per kind.
 * @param {any} p The value to check.
 * @param {string[]} [unitKeys] When given, the proposal must account for exactly these units.
 * @returns {asserts p is FitProposal}
 */
export function assertFitProposal(p, unitKeys) {
  if (!p || typeof p !== 'object') fail('The fit proposal', 'be an object');
  str(p.feature, "The fit proposal's feature");
  arr(p.blocks, "The fit proposal's blocks");
  arr(p.unassigned, "The fit proposal's unassigned");
  const seen = new Set();
  const note = (fp) => { if (seen.has(fp)) fail(`The unit ${fp}`, 'go to exactly one block'); seen.add(fp); };
  p.unassigned.forEach((u, i) => { str(u?.unit, `Unassigned unit ${i}'s unit`); sentence(u.sentence, `Unassigned unit ${i}'s sentence`); note(u.unit); });
  const names = new Set();
  p.blocks.forEach((b, i) => {
    const w = `Fit block ${i}`;
    oneOf(b?.kind, FIT_BLOCK_KINDS, `${w}'s kind`);
    str(b.name, `${w}'s name`);
    if (names.has(`${b.kind}:${b.name}`)) fail(`${w}'s name`, `be unique among the ${b.kind} blocks`);
    names.add(`${b.kind}:${b.name}`);
    strs(b.units, `${w}'s units`);
    if (!b.units.length) fail(`${w}'s units`, 'hold at least one unit');
    strs(b.from, `${w}'s from`);
    if (!b.from.length) fail(`${w}'s from`, 'say where the code is now');
    sentence(b.sentence, `${w}'s sentence`);
    if (b.area !== undefined) oneOf(b.area, ['feature', 'library'], `${w}'s area`);
    b.units.forEach(note);
  });
  if (unitKeys) {
    const missing = unitKeys.filter((k) => !seen.has(k));
    if (missing.length) fail(`The fit proposal's ${missing.length} unplaced unit${missing.length === 1 ? '' : 's'}, such as ${missing[0]},`, 'be in a block or listed as unassigned');
    if (seen.size !== new Set(unitKeys).size) fail("The fit proposal's units", 'all be units of the map');
  }
}

/**
 * Throw a one-sentence TypeError unless `s` is a MapSummary.
 * @param {any} s The value to check.
 * @param {string} where
 * @returns {asserts s is MapSummary}
 */
function assertMapSummary(s, where) {
  if (!s || typeof s !== 'object') fail(where, 'be {units, counts, hash}');
  int(s.units, `${where}'s units`);
  str(s.hash, `${where}'s hash`);
}

/**
 * Throw a one-sentence TypeError unless `s` is an ImportLoopState (one checked step, fixed-size).
 * @param {any} s The value to check.
 * @returns {asserts s is ImportLoopState}
 */
export function assertImportLoopState(s) {
  if (!s || typeof s !== 'object') fail('The import loop state', 'be an object');
  str(s.step, "The import loop state's step");
  int(s.n, "The import loop state's n", 1);
  str(s.tool, "The import loop state's tool");
  if (s.mapBefore !== null) assertMapSummary(s.mapBefore, "The import loop state's mapBefore");
  assertMapSummary(s.mapAfter, "The import loop state's mapAfter");
  for (const k of ['kept', 'moved', 'added', 'changed', 'missingCount']) int(s.diff?.[k], `The import loop state's diff.${k}`);
  arr(s.diff.missing, "The import loop state's diff.missing");
  for (const k of ['passed', 'failed', 'total']) int(s.tests?.[k], `The import loop state's tests.${k}`);
  for (const k of ['covered', 'uncovered', 'waived', 'total']) int(s.coverage?.[k], `The import loop state's coverage.${k}`);
  arr(s.checks, "The import loop state's checks");
  oneOf(s.status, ['ok', 'stopped'], "The import loop state's status");
  sentence(s.sentence, "The import loop state's sentence");
  arr(s.fixes, "The import loop state's fixes");
}

/**
 * Throw a one-sentence TypeError unless `l` is the import plan file's loop record (or absent).
 * @param {any} l The value to check.
 * @param {string} [where]
 * @returns {void}
 */
export function assertImportLogic(l, where = 'The import logic') {
  if (l === undefined || l === null) return;
  if (typeof l !== 'object' || !Array.isArray(l.waivers) || !Array.isArray(l.loop) || !Array.isArray(l.tests)) fail(where, 'be {route, closure, map, fit, tests, baselineTests, waivers, loop, last}');
  const isRoute = (r) => typeof r === 'string' && r.startsWith('/');
  if (l.route !== null && !isRoute(l.route) && !(Array.isArray(l.route) && l.route.length > 0 && l.route.every(isRoute))) fail(`${where}'s route`, 'be null, a route like /alerts, or a list of routes');
  if (l.feature !== undefined && (typeof l.feature !== 'string' || !/^[a-z][a-z0-9-]*$/.test(l.feature))) fail(`${where}'s feature`, 'be a kebab-case feature name');
  if (l.map) assertMapSummary(l.map, `${where}'s map`);
  if (l.fit) { str(l.fit.feature, `${where}'s fit.feature`); sentence(l.fit.sentence, `${where}'s fit.sentence`); }
  if (l.atoms) { oneOf(l.atoms.via, ['static', 'off'], `${where}'s atoms.via`); sentence(l.atoms.sentence, `${where}'s atoms.sentence`); }
  // Only a person waives a unit: every waiver is the owner's.
  l.waivers.forEach((w, i) => assertUnitWaiver(w, `${where}'s waiver ${i}`));
  l.loop.forEach((st, i) => {
    str(st?.step, `${where}'s loop state ${i}'s step`);
    oneOf(st.status, ['ok', 'stopped'], `${where}'s loop state ${i}'s status`);
    sentence(st.sentence, `${where}'s loop state ${i}'s sentence`);
  });
}

const ATOM_COUNTS = ['functions', 'converted', 'partial', 'unchanged', 'unchecked', 'rewrites', 'takenBack', 'refused', 'repaired'];

/**
 * One function's static breakdown (AtomUnitResult): a rewrite that counts has a `same` check.
 * @param {any} u
 * @param {string} [where]
 */
export function assertAtomUnitResult(u, where = 'The atom breakdown unit') {
  if (!u || typeof u !== 'object') fail(where, 'be an object');
  str(u.file, `${where}'s file`); str(u.name, `${where}'s name`); str(u.block, `${where}'s block`);
  oneOf(u.status, ATOM_UNIT_STATUS, `${where}'s status`);
  oneOf(u.check?.status, ['same', 'different', 'unchecked'], `${where}'s check.status`);
  for (const k of ['runs', 'compared', 'exercised', 'mismatchCount']) int(u.check[k], `${where}'s check.${k}`);
  strs(u.atoms, `${where}'s atoms`);
  int(u.rewrites, `${where}'s rewrites`); int(u.takenBack, `${where}'s takenBack`);
  str(u.code, `${where}'s code`); str(u.body, `${where}'s body`);
  if (typeof u.importDecl !== 'string') fail(`${where}'s importDecl`, 'be a string');
  if (u.importDecl && !u.importDecl.endsWith(` from '${ATOMS_PACKAGE}';`)) fail(`${where}'s importDecl`, `import from '${ATOMS_PACKAGE}'`);
  arr(u.untranslated, `${where}'s untranslated`);
  u.untranslated.forEach((p, i) => { str(p.form, `${where}'s untranslated[${i}].form`); str(p.text, `${where}'s untranslated[${i}].text`); int(p.line, `${where}'s untranslated[${i}].line`, 1); });
  // The rule the breakdown exists for: a rewrite counts only when the check says the function behaves the same.
  if ((u.status === 'converted' || u.status === 'partial') && (u.check.status !== 'same' || u.rewrites === 0)) fail(where, 'count a rewrite only when the check says same');
  if ((u.status === 'unchanged' || u.status === 'unchecked') && u.body !== u.code) fail(`${where}'s body`, 'be the original when no rewrite counts');
  if (u.status === 'converted' && u.untranslated.length) fail(where, 'leave no part untranslated when converted');
  if (u.repair) { str(u.repair.outcome, `${where}'s repair.outcome`); sentence(u.repair.sentence, `${where}'s repair.sentence`); }
  if (u.written) {
    if (u.status !== 'converted') fail(`${where}'s written`, 'be set only on a converted unit');
    str(u.written.file, `${where}'s written.file`); sentence(u.written.sentence, `${where}'s written.sentence`);
  }
  if (u.english) {
    if (!u.written) fail(`${where}'s english`, 'be set only on a written unit');
    assertEnglishView(u.english, `${where}'s english`);
  }
  sentence(u.sentence, `${where}'s sentence`);
}

/**
 * A function's read-only English view (EnglishView).
 * @param {any} v
 * @param {string} [where]
 */
export function assertEnglishView(v, where = 'The English view') {
  if (!v || typeof v !== 'object') fail(where, 'be an object');
  oneOf(v.via, ['fluent', 'off'], `${where}'s via`);
  if (typeof v.code !== 'string') fail(`${where}'s code`, 'be a string');
  arr(v.sentences, `${where}'s sentences`);
  v.sentences.forEach((x, i) => { str(x?.atom, `${where}'s sentences[${i}].atom`); str(x?.sentence, `${where}'s sentences[${i}].sentence`); });
  arr(v.reasons, `${where}'s reasons`);
  v.reasons.forEach((x, i) => { str(x?.atom, `${where}'s reasons[${i}].atom`); str(x?.reason, `${where}'s reasons[${i}].reason`); });
  int(v.plain, `${where}'s plain`);
  if (v.plain !== v.reasons.length) fail(`${where}'s plain`, 'count its reasons');
  if (typeof v.full !== 'boolean') fail(`${where}'s full`, 'be a boolean');
  if (v.full !== (v.sentences.length > 0 && v.reasons.length === 0)) fail(`${where}'s full`, 'be true exactly when every atom call is a sentence');
  if (v.via === 'off') {
    str(v.reason, `${where}'s reason`);
    if (v.code || v.sentences.length || v.reasons.length) fail(where, 'be empty when off');
  } else str(v.code, `${where}'s code`);
  sentence(v.sentence, `${where}'s sentence`);
}

/**
 * The static breakdown of an import (AtomBreakdown).
 * @param {any} b
 */
export function assertAtomBreakdown(b) {
  const where = 'The atom breakdown';
  if (!b || typeof b !== 'object') fail(where, 'be an object');
  oneOf(b.via, ['static', 'off'], `${where}'s via`);
  arr(b.units, `${where}'s units`);
  b.units.forEach((u, i) => assertAtomUnitResult(u, `${where}'s unit ${i}`));
  for (const k of ATOM_COUNTS) int(b.counts?.[k], `${where}'s counts.${k}`);
  if (b.counts.functions !== b.units.length) fail(`${where}'s counts.functions`, 'equal the number of units');
  if (b.via === 'off') { if (b.units.length) fail(where, 'have no units when off'); sentence(b.reason, `${where}'s reason`); }
  sentence(b.sentence, `${where}'s sentence`);
}
