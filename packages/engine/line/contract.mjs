// Line Cockpit contract: the shapes every parallel task builds against (model, operations, HTTP API).
// No logic lives here except the runtime shape checks, which the real implementations and the mock
// (mock.mjs) both pass in test/line-contract.test.mjs. Change a shape here first, then its users.
//
//   T1 model      readLineProject, lineFindings        packages/engine/line/model.mjs
//   T2 ops        planBaseOn, planPromote, applyChange packages/engine/line/ops.mjs
//   T3 page prop  planSetProp                          packages/engine/line/pageProp.mjs
//   cu6 workspace readWorkspace, setWorkspace            packages/engine/line/workspace.mjs
//   cu2 AI layer  stepProfile, decide, decideUntilAccepted packages/core/ai-profiles.mjs, packages/core/line-decide.mjs
//   T4 server     LINE_API routes                      ui/server/src/lineApi.mjs (mounted at /api/line)
//   T5/T6 UI      ui/client/features/line-* through services/LineApi.ts (a typed mirror of LINE_API)
//
// Rules every task keeps: writes happen only in applyChange, through packages/engine/transactionalWriter.mjs
// (createTransaction().commit()), so the project's own validate profile gates them; every message a person
// sees is one plain-English sentence, with rule ids and paths kept as separate fields for a Details view.

/** @typedef {'components'|'pages'|'workflows'|'fixtures'} LineKind */
/** @typedef {'atom'|'molecule'|'organism'} Level */

/**
 * One finding, as Cockpit shows it: the sentence first, the technical part separate.
 * @typedef {object} LineFinding
 * @property {string} sentence  Plain English: what is wrong and how to fix it (the validate message).
 * @property {string} rule      Rule id, e.g. "LINE-DIR".
 * @property {'error'|'warning'|'info'} severity
 * @property {string} file      Root-relative path.
 * @property {number} line      1-based.
 * @property {string} [key]     Stable handle for POST /api/line/fix: "<rule>|<file>|<line>" (fixes.mjs findingKey).
 * @property {LineFix[]} [fixes] Typed fixes (fixes.mjs fixesFor), recommended first; absent on findings that are not LINE-*.
 */

/**
 * The Line tools a fix step may call (each one is a pure planner returning a StagedChange; fixes.mjs planStep):
 *   line.setBase      {file, libraryId}          rewrite the item's base link (the line-base header, or "$lineBase" in JSON) to one library item
 *   line.promote      PromoteRequest             move a feature item into the library and re-point its users (ops.mjs planPromote)
 *   line.baseOn       BaseOnRequest              create a feature item based on a library item (ops.mjs planBaseOn)
 *   line.moveFile     {from, to, base?}          move a file, re-pointing every import; `base` also writes its line-base header
 *   line.createLayout {}                         create the library folder (library/README.md) so the project is laid out as Line
 * @typedef {'line.setBase'|'line.promote'|'line.baseOn'|'line.moveFile'|'line.createLayout'} LineFixTool
 */

/**
 * One typed fix for a finding: what it will do in plain English, and the plan step that does it. `step` is null when
 * no safe mechanical fix exists; the sentence then says what to do instead.
 * @typedef {object} LineFix
 * @property {string} id        Stable for the same finding on the same files, e.g. "LINE-DIR/promote" or "LINE-BASE/set-base:components/Card".
 * @property {string} sentence  Plain English: what applying it will do.
 * @property {number} rank      1 is the recommended ("likely") fix; fixes come sorted by rank.
 * @property {{tool: LineFixTool, args: Record<string, unknown>}|null} step
 */

/** @typedef {{findingKey: string, fixId: string}} FixRequest */

/**
 * A library item (complete and usable on its own).
 * @typedef {object} LibraryItem
 * @property {string} id        "<kind>/<Name>", the value a feature item's base link (line-base pragma) names.
 * @property {LineKind} kind
 * @property {string} name
 * @property {string} file      Root-relative path.
 * @property {Level} [level]    Components only: atom (no library imports), molecule (imports atoms only), organism (anything else); a "line-level" pragma comment (at-sign line-level) overrides.
 * @property {{feature: string, file: string}[]} usedBy  Feature items based on it.
 */

/**
 * A feature item (based on exactly one library item, owned by one feature).
 * @typedef {object} FeatureItem
 * @property {string} id        "<feature>/<kind>/<Name>".
 * @property {LineKind} kind
 * @property {string} name
 * @property {string} feature
 * @property {string} file
 * @property {{value: string|null, libraryId: string|null}} base  The base link (line-base pragma) as written, and the library item it resolves to (null when missing or broken).
 * @property {'ok'|'problem'} status  "problem" when any finding points at this file.
 * @property {LineFinding[]} findings
 */

/**
 * @typedef {object} LineFeature
 * @property {string} name
 * @property {string|null} spec   Root-relative path of spec.md, or null.
 * @property {FeatureItem[]} items
 */

/**
 * The whole Line view of a project (read-only).
 * @typedef {object} LineProject
 * @property {boolean} isLine     True when architecture.yml's preset is "line".
 * @property {{library: string, features: string, state: string}} layout
 * @property {LibraryItem[]} library
 * @property {LineFeature[]} features
 * @property {LineFinding[]} findings  Every finding of the project's validate profile.
 */

/**
 * Files a change would write, before anything touches disk.
 * @typedef {object} StagedChange
 * @property {string} summary   One sentence: what the change does, e.g. "Creates OrderButton in feature orders, based on the library Button."
 * @property {{path: string, content: string|null}[]} files  Root-relative; content null deletes the file.
 */

/**
 * The outcome of applying a change through the writer.
 * @typedef {object} ApplyResult
 * @property {boolean} ok         True when the change landed.
 * @property {string} sentence    One plain-English sentence for the person, success or refusal.
 * @property {string[]} files     The files written (empty when refused).
 * @property {LineFinding[]} findings  Why it was refused (empty when it landed).
 * @property {string} [code]      A refusal's stable id when it is not a validate finding, e.g. "OUTSIDE_WORKSPACE".
 */

/**
 * The one folder of a project Line may change (cu6). Everything outside it is read-only: applyChange refuses any
 * staged file outside it with code OUTSIDE_WORKSPACE. Stored in the project's `<state>/workspace.json` (Line's own
 * state, `line/` by default); no file means the whole project.
 * @typedef {object} LineWorkspace
 * @property {string} root       The project root (absolute).
 * @property {string} folder     Root-relative posix folder, no trailing slash; '' = the whole project.
 * @property {true} readOnly     Always true: everything outside `folder` is read-only for Line.
 */

/** Requests of the write operations. */
/** @typedef {{libraryId: string, feature: string, name: string}} BaseOnRequest */
/** @typedef {{featureItemId: string}} PromoteRequest */
/** @typedef {{folder: string}} WorkspaceRequest */
/** @typedef {{file: string, nodeId: string, prop: string, kind: 'string'|'number'|'boolean'|'expression', value: string|number|boolean}} SetPropRequest */

/** @typedef {'prop-expression'|'handler'|'condition'|'style'} FragmentKind */

/**
 * One fragment of code a person can edit in place (cx1, packages/engine/line/fragments.mjs): a prop's value
 * expression, an event handler, a condition or a style value, never the whole file.
 * @typedef {object} CodeFragment
 * @property {string} id         Stable for the source it came from, e.g. "handler:n0:onClick"; pass it to SetFragmentRequest.
 * @property {string} file       Root-relative path.
 * @property {FragmentKind} kind
 * @property {string} label      Plain English, e.g. "What happens when Save is clicked".
 * @property {string} code       The fragment's source text exactly as written.
 * @property {{start: number, end: number}} range  UTF-16 offsets in the file, [start, end).
 * @property {string} contentHash sha256 of the whole file the range was computed from.
 * @property {string} nodeId     The page-tree part ("n0", ...) the fragment sits on (page-tree ids).
 */

/**
 * GET /api/line/fragments?file=: every editable fragment of one library or feature code file.
 * @typedef {{file: string, contentHash: string, fragments: CodeFragment[]}} FragmentList
 */

/** POST /api/line/fragment: replace only that fragment's range with `code`. @typedef {{file: string, fragmentId: string, code: string, contentHash: string}} SetFragmentRequest */

/**
 * The operations (implemented by model.mjs, ops.mjs and pageProp.mjs; faked by mock.mjs). Every plan
 * function is pure: it reads the project and returns a StagedChange, or throws a LineOpError.
 * @typedef {object} LineOps
 * @property {(root: string) => LineProject} readLineProject
 * @property {(root: string, name: string) => LineFeatureDetail} readLineFeature
 * @property {(root: string, req: BaseOnRequest) => StagedChange} planBaseOn
 * @property {(root: string, req: PromoteRequest) => StagedChange} planPromote
 * @property {(root: string, req: SetPropRequest) => StagedChange} planSetProp
 * @property {(root: string, file: string) => FragmentList} listFragments
 * @property {(root: string, req: SetFragmentRequest) => StagedChange} planSetFragment
 * @property {(root: string, change: StagedChange) => ApplyResult} applyChange
 * @property {(root: string) => LineWorkspace} readWorkspace
 * @property {(root: string, req: WorkspaceRequest) => LineWorkspace} setWorkspace
 * @property {(root: string, req: FixRequest) => ApplyResult} applyFix  Re-derive the finding by key, plan its fix, applyChange (fixes.mjs).
 */

/**
 * One prop of a rendered component (T7, packages/engine/line/renderComponent.mjs): its react-docgen type, the kind
 * Cockpit edits it as, and the value used (a sample, a fixture value or the person's); null when it has none.
 * @typedef {object} RenderProp
 * @property {string} name
 * @property {string} type     As written in the source, e.g. "string", "number", "'primary' | 'ghost'".
 * @property {'string'|'number'|'boolean'|'other'} kind
 * @property {string|number|boolean|null|unknown} value
 */

/**
 * GET /api/line/render?file=<root-relative <library>/components file>&props=<JSON object>: one library component
 * rendered alone to a themed HTML document (pure read). A refusal (path outside `<library>/components`, bad props)
 * is HTTP 400; no renderer (`NO_RENDERER`, the Morpheus link is down) or a failed render (`RENDER_FAILED`) is 200
 * with `ok: false`, the sentence, the technical reason under `detail`, and the props still listed.
 * @typedef {{ok: true, html: string, props: RenderProp[], via: 'morpheus'|'construct-preview'}
 *   | {ok: false, code: string, sentence: string, detail?: string, props?: RenderProp[]}} RenderResult
 */

/**
 * GET /api/line/feature?name=<feature>: one feature as the Features screen shows it (pure read; readLineFeature in
 * packages/engine/line/feature.mjs). Items are the model's FeatureItems grouped by kind; the summary is written by
 * static rules from the items, their bases and their imports (no model, `via: 'static'`); the spec is the feature's
 * spec.md split into stories (a "## " heading each) and acceptance points (the list items under it), each point
 * covered when it names a feature item or a test title of the feature (static matching), with `by` saying which.
 * An unknown feature is a LineOpError UNKNOWN_ITEM (HTTP 400).
 * @typedef {object} LineFeatureDetail
 * @property {string} name
 * @property {Record<LineKind, FeatureItem[]>} items  Every kind is present, empty when the feature has none.
 * @property {{sentences: string[], via: 'static'}} summary
 * @property {{file: string, stories: {id: string, text: string, points: {id: string, text: string, covered: boolean, by: string[]}[]}[]}|null} spec  Null when the feature has no spec.md.
 * @property {LineFinding[]} findings  Every finding inside the feature's folder.
 */

/**
 * cu2: one AI step's profile. Cockpit's LLM capabilities, Trace's AI tasks and the @mx/reason pairs are ONE set of these
 * (packages/core/ai-profiles.json). Static runs first; `ladder` says which model rungs are on (reason's ladder shape).
 * @typedef {object} StepProfile
 * @property {string} step        Stable id "<app>.<task>", e.g. "construct.chooser", "trace.choose", "cockpit.importFill".
 * @property {string} label       Plain English: what the step does, one sentence.
 * @property {'decide'|'draft'} kind  decide: pick one of closed options (static, Qwen suggests, jev decides, Qwen gives the reasons); draft: Qwen writes text that static checks.
 * @property {'ollama'|'hosted'} provider  ollama: a local model; hosted: a hosted model the person configures (never local).
 * @property {string|null} model  The model the step uses; the local default is qwen2.5-coder:1.5b. Null only for a hosted step.
 * @property {string} modelFrom   Plain English: where the model comes from ("Line's default", "trace/ai.config.json").
 * @property {number} maxTokens   The reply cap for the step's model (Qwen's proposer reads it; 800 for plan steps).
 * @property {'static'} fallback  When the model is down or not linked, the static path answers and says so.
 * @property {{static: {target: number}, options: {on: boolean, target: number}, review: {on: boolean, target: number}, measured: string|null}} ladder
 * @property {'cockpit'|'trace'|'construct'} source  Which app's step it is.
 */

/**
 * cu2: Construct's standard feedback to any AI step: the refusal sentence and its typed fixes (the LineFinding's
 * sentence and fixes, or an ApplyResult's sentence and its findings' fixes).
 * @typedef {{sentence: string, fixes: {id: string, sentence: string, rank: number}[]}} Refusal
 */

/**
 * cu2: what decide(step, options, context) answers. `via` names who decided: static (the checks or their order), jev (it
 * picked among the checked options), model (Qwen's suggestion stood because jev was not available). `reasons` are full
 * plain-English sentences (Qwen's reason when it gave one); `attribution` is what a decision trace records. With
 * `context.refusal`, the options ARE the refusal's typed fixes and `feedback` is true.
 * @typedef {object} DecideResult
 * @property {string} step
 * @property {string|null} choice      An option id that passed the checks, or null (nothing passed: ask the person).
 * @property {string|null} runnerUp
 * @property {'static'|'jev'|'model'} via
 * @property {'single'|'order'|'jev'|'model'|'none'} by
 * @property {string[]} reasons
 * @property {boolean} lowConfidence  jev and Qwen disagreed, or nothing passed: with Auto off, ask the person.
 * @property {boolean} feedback        The options were Construct's typed fixes for a refusal.
 * @property {{step: string, provider: '@mx/reason'|'static', decider: 'static'|'jev'|'qwen', model: string|null, version: string, fellBackFrom: 'jev'|'reason'|null, note: string|null}} attribution
 */

/**
 * cu2: decideUntilAccepted(step, options, context, {apply, score}): decide, apply the choice through Construct; on a
 * refusal decide again with {refusal sentence, typed fixes} as the options; stop when it lands, or when a round does not
 * improve the score (then ONE question for the person).
 * @typedef {object} DecideLoopResult
 * @property {'accepted'|'ask'} outcome
 * @property {{decision: DecideResult, ok: boolean, score: number, refusal: Refusal|null}[]} rounds
 * @property {{sentence: string, options: {id: string, sentence: string}[]}|null} question  Set exactly when outcome is ask.
 */

/**
 * cu2: GET /api/line/ai-profiles, the read-only Settings view of every AI step.
 * @typedef {object} AiProfiles
 * @property {string} defaultModel   qwen2.5-coder:1.5b.
 * @property {StepProfile[]} profiles
 * @property {{linked: boolean, sentence: string}} reason  Whether @mx/reason (jev and the ladder) is linked, in one sentence.
 */

/** A refused request (bad name, unknown item, name taken). `sentence` is shown as is; `detail` (optional) is the
 * technical reason (a parser or type-checker message) for a collapsed Details. */
export class LineOpError extends Error {
  /** @param {string} sentence @param {string} code @param {string} [detail] */
  constructor(sentence, code, detail) {
    super(sentence); this.name = 'LineOpError'; this.sentence = sentence; this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

/**
 * The HTTP API ui/server serves under /api/line. Responses are JSON; a LineOpError becomes
 * 400 `{ok: false, sentence, code}`. Every route takes the open project from the session as today.
 */
export const LINE_API = Object.freeze([
  { method: 'GET', path: '/api/line/project', request: null, response: 'LineProject' },
  { method: 'GET', path: '/api/line/page-tree', request: 'file (query)', response: 'PageTree (pageProp.mjs)' },
  { method: 'POST', path: '/api/line/base-on', request: 'BaseOnRequest', response: 'ApplyResult' },
  { method: 'POST', path: '/api/line/promote', request: 'PromoteRequest', response: 'ApplyResult' },
  { method: 'POST', path: '/api/line/page-prop', request: 'SetPropRequest', response: 'ApplyResult' },
  { method: 'GET', path: '/api/line/render', request: 'file, props (query)', response: 'RenderResult' },
  { method: 'GET', path: '/api/line/feature', request: 'name (query)', response: 'LineFeatureDetail' },
  { method: 'GET', path: '/api/line/workspace', request: null, response: 'LineWorkspace' },
  { method: 'POST', path: '/api/line/workspace', request: 'WorkspaceRequest', response: 'LineWorkspace' },
  { method: 'POST', path: '/api/line/fix', request: 'FixRequest', response: 'ApplyResult' },
  { method: 'GET', path: '/api/line/fragments', request: 'file (query)', response: 'FragmentList' },
  { method: 'POST', path: '/api/line/fragment', request: 'SetFragmentRequest', response: 'ApplyResult' },
  { method: 'GET', path: '/api/line/ai-profiles', request: null, response: 'AiProfiles' },
]);

export const LINE_FIX_TOOLS = Object.freeze(['line.setBase', 'line.promote', 'line.baseOn', 'line.moveFile', 'line.createLayout']);

export const LINE_KINDS = Object.freeze(['components', 'pages', 'workflows', 'fixtures']);
export const LEVELS = Object.freeze(['atom', 'molecule', 'organism']);
export const FRAGMENT_KINDS = Object.freeze(['prop-expression', 'handler', 'condition', 'style']);
/** cu2: the local model every AI step uses unless its profile names another. */
export const DEFAULT_STEP_MODEL = 'qwen2.5-coder:1.5b';
export const DECIDE_VIA = Object.freeze(['static', 'jev', 'model']);
export const DECIDE_BY = Object.freeze(['single', 'order', 'jev', 'model', 'none']);

// ---------------------------------------------------------------------------------------------
// Runtime shape checks: the contract tests run them over the mock and every real implementation.

const fail = (where, what) => { throw new TypeError(`${where}: ${what}`); };
const str = (v, where) => (typeof v === 'string' && v.length > 0) || fail(where, 'must be a non-empty string');
const sentence = (v, where) => { str(v, where); if (!/^\S.*[.?!]$/s.test(v)) fail(where, `must be a full sentence ending in . ? or !: ${JSON.stringify(v)}`); };

/**
 * Throw a TypeError naming the bad field unless `f` is a Finding: a full sentence, a rule id, a severity, a file and a 1-based line.
 * @param {any} f The value to check.
 * @param {string} [where] Where it sits, for the error message.
 * @returns {void}
 */
export function assertFinding(f, where = 'finding') {
  sentence(f?.sentence, `${where}.sentence`);
  str(f.rule, `${where}.rule`);
  if (!['error', 'warning', 'info'].includes(f.severity)) fail(`${where}.severity`, 'must be error, warning or info');
  str(f.file, `${where}.file`);
  if (!Number.isInteger(f.line) || f.line < 1) fail(`${where}.line`, 'must be a 1-based integer');
  if (f.key !== undefined) str(f.key, `${where}.key`);
  if (f.fixes !== undefined) {
    if (!Array.isArray(f.fixes)) fail(`${where}.fixes`, 'must be an array');
    const ids = new Set();
    f.fixes.forEach((x, i) => {
      assertFix(x, `${where}.fixes[${i}]`);
      if (ids.has(x.id)) fail(`${where}.fixes[${i}].id`, 'must be unique within the finding');
      ids.add(x.id);
      if (i > 0 && x.rank < f.fixes[i - 1].rank) fail(`${where}.fixes`, 'must be sorted by rank, recommended first');
    });
  }
}

/** @param {any} x @param {string} where */
export function assertFix(x, where = 'fix') {
  str(x?.id, `${where}.id`);
  sentence(x.sentence, `${where}.sentence`);
  if (typeof x.rank !== 'number' || !Number.isFinite(x.rank) || x.rank < 1) fail(`${where}.rank`, 'must be a number from 1');
  if (x.step !== null) {
    if (!LINE_FIX_TOOLS.includes(x.step?.tool)) fail(`${where}.step.tool`, `must be one of ${LINE_FIX_TOOLS.join(', ')}`);
    if (!x.step.args || typeof x.step.args !== 'object' || Array.isArray(x.step.args)) fail(`${where}.step.args`, 'must be an object');
  }
}

/**
 * Throw a TypeError naming the bad field unless `p` is a LineProject: library ids, feature items, bases and findings all consistent.
 * @param {any} p The value to check.
 * @returns {asserts p is LineProject}
 */
export function assertLineProject(p) {
  if (typeof p?.isLine !== 'boolean') fail('project.isLine', 'must be a boolean');
  for (const k of ['library', 'features', 'state']) str(p.layout?.[k], `project.layout.${k}`);
  if (!Array.isArray(p.library)) fail('project.library', 'must be an array');
  const libIds = new Set();
  p.library.forEach((it, i) => {
    const w = `project.library[${i}]`;
    if (!LINE_KINDS.includes(it.kind)) fail(`${w}.kind`, 'unknown kind');
    if (it.id !== `${it.kind}/${it.name}`) fail(`${w}.id`, 'must be "<kind>/<name>"');
    str(it.file, `${w}.file`);
    if (it.kind === 'components' ? !LEVELS.includes(it.level) : it.level !== undefined) fail(`${w}.level`, 'components have a level, other kinds none');
    if (!Array.isArray(it.usedBy)) fail(`${w}.usedBy`, 'must be an array');
    libIds.add(it.id);
  });
  if (!Array.isArray(p.features)) fail('project.features', 'must be an array');
  p.features.forEach((f, i) => {
    str(f.name, `project.features[${i}].name`);
    if (f.spec !== null) str(f.spec, `project.features[${i}].spec`);
    f.items.forEach((it, j) => {
      const w = `project.features[${i}].items[${j}]`;
      if (it.feature !== f.name) fail(`${w}.feature`, 'must equal its feature\'s name');
      if (it.id !== `${f.name}/${it.kind}/${it.name}`) fail(`${w}.id`, 'must be "<feature>/<kind>/<name>"');
      if (it.base.libraryId !== null && !libIds.has(it.base.libraryId)) fail(`${w}.base.libraryId`, 'must name a library item or be null');
      if (!['ok', 'problem'].includes(it.status)) fail(`${w}.status`, 'must be ok or problem');
      if ((it.status === 'problem') !== it.findings.length > 0) fail(`${w}.status`, 'is "problem" exactly when it has findings');
      it.findings.forEach((x, k) => assertFinding(x, `${w}.findings[${k}]`));
    });
  });
  p.findings.forEach((x, k) => assertFinding(x, `project.findings[${k}]`));
}

/**
 * Throw a TypeError naming the bad field unless `c` is a StagedChange: a sentence summary and at least one root-relative file.
 * @param {any} c The value to check.
 * @returns {asserts c is StagedChange}
 */
export function assertStagedChange(c) {
  sentence(c?.summary, 'change.summary');
  if (!Array.isArray(c.files) || c.files.length === 0) fail('change.files', 'must list at least one file');
  for (const f of c.files) {
    str(f.path, 'change.files[].path');
    if (f.path.startsWith('/') || f.path.split('/').includes('..')) fail('change.files[].path', 'must be root-relative and stay inside the project');
    if (f.content !== null && typeof f.content !== 'string') fail('change.files[].content', 'must be a string or null');
  }
}

/**
 * Throw a TypeError naming the bad field unless `r` is an ApplyResult; a refused change must have written nothing.
 * @param {any} r The value to check.
 * @returns {asserts r is ApplyResult}
 */
export function assertApplyResult(r) {
  if (typeof r?.ok !== 'boolean') fail('result.ok', 'must be a boolean');
  sentence(r.sentence, 'result.sentence');
  if (!Array.isArray(r.files) || !Array.isArray(r.findings)) fail('result', 'files and findings must be arrays');
  if (r.ok && r.findings.some((f) => f.severity === 'error')) fail('result', 'a landed change carries no error findings');
  if (!r.ok && r.files.length) fail('result.files', 'a refused change wrote nothing');
  r.findings.forEach((x, k) => assertFinding(x, `result.findings[${k}]`));
  if (r.code !== undefined) str(r.code, 'result.code');
}

/** @param {any} w @returns {asserts w is LineWorkspace} */
export function assertLineWorkspace(w) {
  str(w?.root, 'workspace.root');
  if (typeof w.folder !== 'string') fail('workspace.folder', 'must be a string');
  if (w.folder !== '' && (w.folder.startsWith('/') || w.folder.endsWith('/') || w.folder.split('/').some((s) => s === '' || s === '.' || s === '..'))) {
    fail('workspace.folder', 'must be a root-relative folder inside the project, or \'\' for the whole project');
  }
  if (w.readOnly !== true) fail('workspace.readOnly', 'must be true');
}

/** @param {any} d @returns {asserts d is LineFeatureDetail} */
export function assertLineFeatureDetail(d) {
  str(d?.name, 'feature.name');
  if (!d.items || typeof d.items !== 'object') fail('feature.items', 'must be an object keyed by kind');
  for (const kind of LINE_KINDS) {
    if (!Array.isArray(d.items[kind])) fail(`feature.items.${kind}`, 'must be an array');
    d.items[kind].forEach((it, j) => {
      const w = `feature.items.${kind}[${j}]`;
      if (it.kind !== kind) fail(`${w}.kind`, `must be ${kind}`);
      if (it.feature !== d.name) fail(`${w}.feature`, 'must equal the feature\'s name');
      if (it.id !== `${d.name}/${kind}/${it.name}`) fail(`${w}.id`, 'must be "<feature>/<kind>/<name>"');
      if ((it.status === 'problem') !== it.findings.length > 0) fail(`${w}.status`, 'is "problem" exactly when it has findings');
      it.findings.forEach((x, k) => assertFinding(x, `${w}.findings[${k}]`));
    });
  }
  if (Object.keys(d.items).some((k) => !LINE_KINDS.includes(k))) fail('feature.items', 'has an unknown kind');
  if (d.summary?.via !== 'static') fail('feature.summary.via', 'must be "static"');
  if (!Array.isArray(d.summary.sentences) || d.summary.sentences.length === 0) fail('feature.summary.sentences', 'must have at least one sentence');
  d.summary.sentences.forEach((s, i) => sentence(s, `feature.summary.sentences[${i}]`));
  if (d.spec !== null) {
    str(d.spec?.file, 'feature.spec.file');
    if (!Array.isArray(d.spec.stories)) fail('feature.spec.stories', 'must be an array');
    const ids = new Set();
    d.spec.stories.forEach((st, i) => {
      const w = `feature.spec.stories[${i}]`;
      str(st.id, `${w}.id`); str(st.text, `${w}.text`);
      if (ids.has(st.id)) fail(`${w}.id`, 'must be unique'); ids.add(st.id);
      if (!Array.isArray(st.points)) fail(`${w}.points`, 'must be an array');
      st.points.forEach((pt, j) => {
        const v = `${w}.points[${j}]`;
        str(pt.id, `${v}.id`); str(pt.text, `${v}.text`);
        if (ids.has(pt.id)) fail(`${v}.id`, 'must be unique'); ids.add(pt.id);
        if (typeof pt.covered !== 'boolean' || !Array.isArray(pt.by)) fail(v, 'covered must be a boolean and by an array');
        if (pt.covered !== pt.by.length > 0) fail(`${v}.covered`, 'is true exactly when something covers it');
      });
    });
  }
  if (!Array.isArray(d.findings)) fail('feature.findings', 'must be an array');
  d.findings.forEach((x, k) => assertFinding(x, `feature.findings[${k}]`));
}

/** @param {any} l @returns {asserts l is FragmentList} */
export function assertFragmentList(l) {
  str(l?.file, 'fragments.file');
  str(l.contentHash, 'fragments.contentHash');
  if (!Array.isArray(l.fragments)) fail('fragments.fragments', 'must be an array');
  const ids = new Set();
  l.fragments.forEach((f, i) => {
    const w = `fragments.fragments[${i}]`;
    str(f.id, `${w}.id`);
    if (ids.has(f.id)) fail(`${w}.id`, 'must be unique');
    ids.add(f.id);
    if (f.file !== l.file) fail(`${w}.file`, 'must equal the list\'s file');
    if (!FRAGMENT_KINDS.includes(f.kind)) fail(`${w}.kind`, 'unknown kind');
    str(f.label, `${w}.label`);
    if (/[.?!]$/.test(f.label)) fail(`${w}.label`, 'is a label, not a sentence');
    str(f.code, `${w}.code`);
    if (!Number.isInteger(f.range?.start) || !Number.isInteger(f.range?.end) || f.range.start < 0 || f.range.end - f.range.start !== f.code.length) fail(`${w}.range`, 'must span exactly the code');
    if (f.contentHash !== l.contentHash) fail(`${w}.contentHash`, 'must equal the list\'s hash');
    str(f.nodeId, `${w}.nodeId`);
  });
}

// cu2 ------------------------------------------------------------------------------------------
const rate = (v, where) => (typeof v === 'number' && v >= 0 && v <= 1) || fail(where, 'must be a number from 0 to 1');
const STEP_ID = /^[a-z]+\.[A-Za-z][\w-]*$/;

/** cu2 @param {any} p @param {string} [where] @returns {asserts p is StepProfile} */
export function assertStepProfile(p, where = 'profile') {
  str(p?.step, `${where}.step`);
  if (!STEP_ID.test(p.step)) fail(`${where}.step`, `must look like "<app>.<task>": ${JSON.stringify(p.step)}`);
  sentence(p.label, `${where}.label`);
  if (!['decide', 'draft'].includes(p.kind)) fail(`${where}.kind`, 'must be decide or draft');
  if (!['ollama', 'hosted'].includes(p.provider)) fail(`${where}.provider`, 'must be ollama or hosted');
  if (p.provider === 'ollama') str(p.model, `${where}.model`);
  else if (p.model !== null && typeof p.model !== 'string') fail(`${where}.model`, 'must be a string or null');
  str(p.modelFrom, `${where}.modelFrom`);
  if (!Number.isInteger(p.maxTokens) || p.maxTokens < 1 || p.maxTokens > 32768) fail(`${where}.maxTokens`, 'must be a whole number from 1 to 32768');
  if (p.fallback !== 'static') fail(`${where}.fallback`, 'must be static');
  const l = p.ladder;
  if (!l || typeof l !== 'object') fail(`${where}.ladder`, 'must be an object');
  rate(l.static?.target, `${where}.ladder.static.target`);
  for (const k of ['options', 'review']) {
    if (typeof l[k]?.on !== 'boolean') fail(`${where}.ladder.${k}.on`, 'must be a boolean');
    rate(l[k].target, `${where}.ladder.${k}.target`);
  }
  if (l.measured !== null && typeof l.measured !== 'string') fail(`${where}.ladder.measured`, 'must be a string or null');
  if (p.kind === 'draft' && l.options.on) fail(`${where}.ladder.options.on`, 'a draft step has no options for jev to pick from');
  if (p.provider === 'hosted' && l.options.on) fail(`${where}.ladder.options.on`, 'jev is a local model; a hosted step cannot turn it on');
  if (!['cockpit', 'trace', 'construct'].includes(p.source)) fail(`${where}.source`, 'must be cockpit, trace or construct');
}

/** cu2 @param {any} r @param {string[]} [optionIds] The ids that were offered, when known. @returns {asserts r is DecideResult} */
export function assertDecideResult(r, optionIds) {
  str(r?.step, 'decide.step');
  if (r.choice !== null) str(r.choice, 'decide.choice');
  if (r.runnerUp !== null) str(r.runnerUp, 'decide.runnerUp');
  if (r.choice !== null && r.runnerUp === r.choice) fail('decide.runnerUp', 'must differ from the choice');
  if (optionIds && r.choice !== null && !optionIds.includes(r.choice)) fail('decide.choice', `must be one of the offered options: ${JSON.stringify(r.choice)}`);
  if (!DECIDE_VIA.includes(r.via)) fail('decide.via', 'must be static, jev or model');
  if (!DECIDE_BY.includes(r.by)) fail('decide.by', 'must be single, order, jev, model or none');
  if ((r.choice === null) !== (r.by === 'none')) fail('decide.by', 'is none exactly when nothing was chosen');
  if ((r.via === 'jev') !== (r.by === 'jev')) fail('decide.via', 'is jev exactly when by is jev');
  if ((r.via === 'model') !== (r.by === 'model')) fail('decide.via', 'is model exactly when by is model');
  if (!Array.isArray(r.reasons) || !r.reasons.length) fail('decide.reasons', 'must hold at least one sentence');
  r.reasons.forEach((x, i) => sentence(x, `decide.reasons[${i}]`));
  if (typeof r.lowConfidence !== 'boolean') fail('decide.lowConfidence', 'must be a boolean');
  if (typeof r.feedback !== 'boolean') fail('decide.feedback', 'must be a boolean');
  const a = r.attribution;
  if (!a || a.step !== r.step) fail('decide.attribution.step', 'must equal the step');
  if (!['@mx/reason', 'static'].includes(a.provider)) fail('decide.attribution.provider', 'must be @mx/reason or static');
  if (!['static', 'jev', 'qwen'].includes(a.decider)) fail('decide.attribution.decider', 'must be static, jev or qwen');
  if ((a.decider === 'jev') !== (r.via === 'jev') || (a.decider === 'qwen') !== (r.via === 'model')) fail('decide.attribution.decider', 'must match via');
  if (a.model !== null) str(a.model, 'decide.attribution.model');
  str(a.version, 'decide.attribution.version');
  if (a.fellBackFrom !== null && !['jev', 'reason'].includes(a.fellBackFrom)) fail('decide.attribution.fellBackFrom', 'must be jev, reason or null');
  if (a.note !== null) sentence(a.note, 'decide.attribution.note');
  if (a.fellBackFrom !== null && a.note === null) fail('decide.attribution.note', 'a fallback says why in one sentence');
}

/** cu2 @param {any} x @returns {asserts x is DecideLoopResult} */
export function assertDecideLoopResult(x) {
  if (!['accepted', 'ask'].includes(x?.outcome)) fail('loop.outcome', 'must be accepted or ask');
  if (!Array.isArray(x.rounds) || !x.rounds.length) fail('loop.rounds', 'must hold at least one round');
  x.rounds.forEach((r, i) => {
    assertDecideResult(r.decision);
    if (typeof r.ok !== 'boolean' || typeof r.score !== 'number') fail(`loop.rounds[${i}]`, 'ok must be a boolean and score a number');
    if (i > 0 && !r.decision.feedback) fail(`loop.rounds[${i}].decision.feedback`, 'a retry decides over the refusal\'s typed fixes');
  });
  const last = x.rounds.at(-1);
  if ((x.outcome === 'accepted') !== last.ok) fail('loop.outcome', 'is accepted exactly when the last round landed');
  if ((x.outcome === 'ask') !== (x.question !== null)) fail('loop.question', 'is set exactly when the outcome is ask');
  if (x.question) {
    sentence(x.question.sentence, 'loop.question.sentence');
    if (!Array.isArray(x.question.options)) fail('loop.question.options', 'must be an array');
  }
}

/** cu2 @param {any} x @returns {asserts x is AiProfiles} */
export function assertAiProfiles(x) {
  str(x?.defaultModel, 'aiProfiles.defaultModel');
  if (!Array.isArray(x.profiles) || !x.profiles.length) fail('aiProfiles.profiles', 'must be a non-empty array');
  const seen = new Set();
  x.profiles.forEach((p, i) => {
    assertStepProfile(p, `aiProfiles.profiles[${i}]`);
    if (seen.has(p.step)) fail(`aiProfiles.profiles[${i}].step`, 'must be unique');
    seen.add(p.step);
  });
  if (typeof x.reason?.linked !== 'boolean') fail('aiProfiles.reason.linked', 'must be a boolean');
  sentence(x.reason.sentence, 'aiProfiles.reason.sentence');
}
