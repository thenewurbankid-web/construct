// Line Cockpit contract: the shapes every parallel task builds against (model, operations, HTTP API).
// No logic lives here except the runtime shape checks, which the real implementations and the mock
// (mock.mjs) both pass in test/line-contract.test.mjs. Change a shape here first, then its users.
//
//   T1 model      readLineProject, lineFindings        packages/engine/line/model.mjs
//   T2 ops        planBaseOn, planPromote, applyChange packages/engine/line/ops.mjs
//   T3 page prop  planSetProp                          packages/engine/line/pageProp.mjs
//   cu6 workspace readWorkspace, setWorkspace            packages/engine/line/workspace.mjs
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
 * cp1 -- Line actions as plan steps (@mx/plan, packages/engine/line/planTools.mjs + planService.mjs). Every Cockpit
 * change (Base on, Promote, set a page prop) is a write step in the open project's plan session
 * (`<root>/line/plans/<sessionId>.json`); only a person approves a write, and only an approved step runs.
 *
 * One expected output of a step: the checks that define "done".
 * @typedef {object} PlanCheck
 * @property {string} id
 * @property {string} sentence  Plain English, e.g. "Validate (profile line) shows no new problems."
 * @property {'validate'|'types'|'tests'|'file'|'spec'} kind
 * @property {LineExpr} [expr]  The check as a machine-checkable expression over the facts (see LineExpr below).
 *
 * Before a step runs: one expected output, already there or not.
 * @typedef {object} GapItem
 * @property {string} checkId
 * @property {'present'|'partial'|'missing'} state
 * @property {string} sentence
 *
 * After a step runs: one check's outcome.
 * @typedef {object} CheckResult
 * @property {string} checkId
 * @property {boolean} ok
 * @property {string} sentence
 *
 * What a person may do when a step needs them.
 * A `fix` option comes from a refusal's findings (fixes.mjs typed fixes): `step` is the plan step that applies it (add it
 * with args.fixOf = the step's id), null for advice only; `recommended` marks rank 1.
 * @typedef {{id: 'retry'|'leave'|'fix', sentence: string, fixId?: string, recommended?: boolean, step?: {tool: string, args: Record<string, unknown>}|null}} StepOption
 *
 * The result a line.* write step records on its plan step.
 * @typedef {object} LineStepResult
 * @property {ApplyResult} apply     What the writer did (narrowed to the files not already there).
 * @property {CheckResult[]} checks
 * @property {number} passed
 * @property {number} total
 * @property {boolean} needsYou      A check failed: the person decides (options), nothing loops on its own.
 * @property {StepOption[]} options
 * @property {boolean} stopped       A retry passed no more checks than the try before it, so Line stopped retrying.
 * @property {string} sentence       One sentence for the Plan panel.
 *
 * A plan step as Cockpit shows it (the @mx/plan step plus Construct's words).
 * @typedef {object} PlanStepView
 * @property {string} id
 * @property {number} n
 * @property {string} tool
 * @property {Record<string, unknown>} args
 * @property {string} why
 * @property {'read'|'write'} kind
 * @property {'waiting'|'ready'|'running'|'done'|'needs-you'|'needs-fix'|'failed'|'skipped'} state  needs-fix: Construct refused the change; its findings' typed fixes are the options
 * @property {string} sentence    E.g. "Waiting for your approval: Creates StatusBadge in feature orders, ...".
 * @property {GapItem[]} gap      Before it runs (empty once it ran).
 * @property {LineStepResult|null} result
 * @property {string|null} error
 *
 * GET /api/line/plan and every plan write answer this.
 * @typedef {object} PlanView
 * @property {true} ok
 * @property {string} sessionId
 * @property {string|null} planId
 * @property {number|null} version
 * @property {string|null} status
 * @property {PlanStepView[]} steps
 * @property {{linked: boolean, sentence: string}} store  Whether @mx/plan is linked or Line uses its built-in plan store.
 * @property {string} [message]
 *
 * @typedef {{tool: string, args?: Record<string, unknown>, why?: string}} PlanStepRequest
 */

/** The plan tools Line adds to the one registry (beside the construct.* commands). */
export const LINE_PLAN_TOOLS = Object.freeze([
  { name: 'line.baseOn', kind: 'write', request: 'BaseOnRequest' },
  { name: 'line.promote', kind: 'write', request: 'PromoteRequest' },
  { name: 'line.setPageProp', kind: 'write', request: 'SetPropRequest' },
  { name: 'line.fix', kind: 'write', request: 'FixRequest' },
  { name: 'line.setFragment', kind: 'write', request: 'SetFragmentRequest' },
  { name: 'line.setBase', kind: 'write', request: '{file, libraryId}' },
  { name: 'line.moveFile', kind: 'write', request: '{from, to, base?}' },
  { name: 'line.createLayout', kind: 'write', request: '{}' },
  { name: 'line.leaveAsIs', kind: 'write', request: '{stepId}' },
  { name: 'line.project', kind: 'read', request: '{}' },
]);
export const CHECK_KINDS = Object.freeze(['validate', 'types', 'tests', 'file', 'spec']);
/** A plan step's states as Cockpit shows them (PlanStepView.state). */
export const PLAN_STEP_STATES = Object.freeze(['waiting', 'ready', 'running', 'done', 'needs-you', 'needs-fix', 'failed', 'skipped']);
/** What a person may do when a step needs them (StepOption.id). */
export const STEP_OPTION_IDS = Object.freeze(['retry', 'leave', 'fix']);
/** The plan protocol in plain English (cl1 spec, plan topic); planService.mjs enforces each sentence. */
export const PLAN_PROTOCOL = Object.freeze([
  'Every action, clicked or typed, is a step in the project\'s plan session; agents add steps only through the plan API.',
  'A change step is planned before it joins the plan, and a request Construct cannot make is refused in one sentence.',
  'Only a person approves a write step, in Cockpit; an agent cannot approve.',
  'Only an approved step runs, one at a time, and every write goes through Construct\'s transactional writer.',
  'After a step runs its checks decide done; a failed check makes the step need the person, with options.',
  'When Construct refuses a change, its findings\' typed fixes are the options; add one with args.fixOf set to the refused step.',
  'While a step needs the person, only its fix, its retry or leaving it as it is may run.',
  'A retry that passes no more checks than the try before it stops instead of looping.',
]);

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
  { method: 'GET', path: '/api/line/plan', request: null, response: 'PlanView' },
  { method: 'POST', path: '/api/line/plan/step', request: 'PlanStepRequest', response: 'PlanView & {stepId}' },
  { method: 'POST', path: '/api/line/plan/approve', request: '{stepId}', response: 'PlanView' },
  { method: 'POST', path: '/api/line/plan/run', request: '{stepId?}', response: 'PlanView' },
]);

export const LINE_FIX_TOOLS = Object.freeze(['line.setBase', 'line.promote', 'line.baseOn', 'line.moveFile', 'line.createLayout']);

export const LINE_KINDS = Object.freeze(['components', 'pages', 'workflows', 'fixtures']);
export const LEVELS = Object.freeze(['atom', 'molecule', 'organism']);
export const FRAGMENT_KINDS = Object.freeze(['prop-expression', 'handler', 'condition', 'style']);

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

/**
 * Throws unless x is a LineFix (id, sentence, rank, a line.* step or null).
 * @param {any} x
 * @param {string} where
 * @returns {void}
 */
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

/**
 * Throws unless w is a LineWorkspace with a folder inside the project.
 * @param {any} w
 * @returns {asserts w is LineWorkspace}
 */
export function assertLineWorkspace(w) {
  str(w?.root, 'workspace.root');
  if (typeof w.folder !== 'string') fail('workspace.folder', 'must be a string');
  if (w.folder !== '' && (w.folder.startsWith('/') || w.folder.endsWith('/') || w.folder.split('/').some((s) => s === '' || s === '.' || s === '..'))) {
    fail('workspace.folder', 'must be a root-relative folder inside the project, or \'\' for the whole project');
  }
  if (w.readOnly !== true) fail('workspace.readOnly', 'must be true');
}

/**
 * Throws unless d is a LineFeatureDetail (items by kind, static summary, spec coverage).
 * @param {any} d
 * @returns {asserts d is LineFeatureDetail}
 */
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

/** @param {any} c @param {string} [where] */
export function assertPlanCheck(c, where = 'check') {
  str(c?.id, `${where}.id`);
  sentence(c.sentence, `${where}.sentence`);
  if (!CHECK_KINDS.includes(c.kind)) fail(`${where}.kind`, `must be one of ${CHECK_KINDS.join(', ')}`);
  if (c.expr !== undefined) { const why = exprProblem(c.expr); if (why) fail(`${where}.expr`, why); }
}

/** @param {any} r @returns {asserts r is LineStepResult} */
export function assertLineStepResult(r) {
  assertApplyResult(r?.apply);
  if (!Array.isArray(r.checks)) fail('stepResult.checks', 'must be an array');
  r.checks.forEach((c, i) => { str(c.checkId, `stepResult.checks[${i}].checkId`); if (typeof c.ok !== 'boolean') fail(`stepResult.checks[${i}].ok`, 'must be a boolean'); sentence(c.sentence, `stepResult.checks[${i}].sentence`); });
  if (r.passed !== r.checks.filter((c) => c.ok).length || r.total !== r.checks.length) fail('stepResult.passed', 'must count the passing checks');
  if (r.needsYou !== r.passed < r.total) fail('stepResult.needsYou', 'is true exactly when a check failed');
  if (r.needsYou && !r.options.length) fail('stepResult.options', 'a step that needs you offers options');
  sentence(r.sentence, 'stepResult.sentence');
}

/** @param {any} v @returns {asserts v is PlanView} */
export function assertPlanView(v) {
  if (v?.ok !== true) fail('plan.ok', 'must be true');
  str(v.sessionId, 'plan.sessionId');
  if (!Array.isArray(v.steps)) fail('plan.steps', 'must be an array');
  if (typeof v.store?.linked !== 'boolean') fail('plan.store.linked', 'must be a boolean');
  sentence(v.store.sentence, 'plan.store.sentence');
  for (const s of v.steps) {
    str(s.id, 'step.id'); str(s.tool, 'step.tool'); sentence(s.sentence, `step ${s.id}.sentence`);
    if (!PLAN_STEP_STATES.includes(s.state)) fail(`step ${s.id}.state`, 'unknown state');
    for (const g of s.gap) { if (!['present', 'partial', 'missing'].includes(g.state)) fail(`step ${s.id}.gap`, 'unknown state'); sentence(g.sentence, `step ${s.id}.gap.sentence`); }
    if (s.result && s.kind === 'write' && s.tool !== 'line.leaveAsIs' && s.tool.startsWith('line.')) assertLineStepResult(s.result);
  }
}

/**
 * Throws unless l is a FragmentList (file, content hash, labelled fragments).
 * @param {any} l
 * @returns {asserts l is FragmentList}
 */
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

// ---------------------------------------------------------------------------------------------
// cl1 -- Claude and Line: Line describes itself from its code (spec.mjs), every plan session leaves a typed local
// trace (trace.mjs, `<root>/line/traces/<traceId>.jsonl`, written through lineState.mjs), Line picks the context for a
// miss statically (contextPicker.mjs) and drafts a framework issue for a refusal that recurs with no working typed fix
// (missDetector.mjs, `<root>/line/issues/<id>.md`; never filed).

/** The spec's own format version; bump it when a topic's shape changes (its content hash is `version`). */
export const SPEC_FORMAT = 1;
/** The spec's topics, the slices `line_spec` serves. */
export const SPEC_TOPICS = Object.freeze(['rules', 'commands', 'plan', 'model', 'modules']);

/**
 * `construct line spec` and the MCP tool `line_spec`: what Line is, generated from its code, never hand-written.
 * @typedef {object} LineSpec
 * @property {1} format          SPEC_FORMAT.
 * @property {string} version    "sha256:<16 hex>" of all topics; changes exactly when a topic's content changes.
 * @property {string} construct  The Construct engine's package version.
 * @property {Partial<Record<'rules'|'commands'|'plan'|'model'|'modules', unknown>>} topics  All topics, or one slice.
 */

/** The kinds of trace event. */
export const TRACE_KINDS = Object.freeze(['step', 'refusal', 'fix-picked', 'outcome']);
/** Plan-protocol refusals (the plan said no, not Construct's rules); every other code is Construct's. */
export const PLAN_REFUSAL_CODES = Object.freeze(['UNKNOWN_TOOL', 'BAD_ARGS', 'NO_PLAN', 'NEEDS_YOU', 'NOTHING_TO_FIX', 'NOT_RETRYABLE', 'STOPPED', 'NOTHING_TO_LEAVE']);

/**
 * One line of a session trace (append-only JSONL). Construct's refusal plus its typed fixes is the feedback for every
 * step, so a refusal records the fixes offered, a `fix-picked` which one was taken, and an `outcome` whether it passed.
 * @typedef {object} TraceEvent
 * @property {1} v
 * @property {string} trace        The trace id (one per plan-service lifetime: a Cockpit server run or an MCP session).
 * @property {number} seq          1, 2, ... within the trace.
 * @property {string} at           ISO time.
 * @property {'step'|'refusal'|'fix-picked'|'outcome'} kind
 * @property {string} by           Who asked: ui, agent, ...
 * @property {string} tool         The plan tool, e.g. line.setFragment.
 * @property {string|null} stepId  The plan step (null for a request refused before it joined the plan).
 * @property {Record<string, unknown>} [args]   step / refusal: the request (long strings cut to 200 characters).
 * @property {string|null} [fixOf] step / fix-picked: the refused step this step fixes.
 * @property {string|null} [retryOf] step: the step this tries again.
 * @property {'construct'|'plan'} [source]  refusal: Construct's rules or the plan protocol.
 * @property {string} [code]       refusal: a stable id ("NEEDS_FIX" when a run was refused with findings).
 * @property {string} [sentence]   refusal / outcome: the plain-English sentence.
 * @property {string[]} [rules]    refusal: rule ids of the error findings.
 * @property {string[]} [files]    refusal: files the findings point at.
 * @property {{fixId: string|null, tool: string|null, recommended: boolean}[]} [fixes]  refusal: the typed fixes offered.
 * @property {string|null} [fixId] fix-picked: which offered fix (null when the step matched none).
 * @property {boolean} [ok]        outcome: every check passed.
 * @property {number} [passed]
 * @property {number} [total]
 * @property {string} [state]      outcome: the step's state after it ran.
 */

/**
 * What Line hands Claude for one miss: exactly these items and files, each with a summary; Claude does not search.
 * @typedef {object} ContextPick
 * @property {{id: string, kind: 'feature-item'|'library-item'|'fixture'|'rule'|'plan-step', why: string}[]} items
 * @property {{file: string, why: string, score: number, summary: {sentence: string, via: string}}[]} files  Ranked.
 * @property {string[]} rules      Rule ids involved.
 * @property {'static'|'jev'} via  Who chose among tied candidates (static order unless a picker was given).
 * @property {boolean} ambiguous   More candidates tied at the cut than fit.
 */

/** @param {any} s @returns {asserts s is LineSpec} */
export function assertLineSpec(s) {
  if (s?.format !== SPEC_FORMAT) fail('spec.format', `must be ${SPEC_FORMAT}`);
  if (!/^sha256:[0-9a-f]{16}$/.test(String(s.version))) fail('spec.version', 'must be "sha256:" and 16 hex digits');
  str(s.construct, 'spec.construct');
  if (!s.topics || typeof s.topics !== 'object') fail('spec.topics', 'must be an object');
  for (const k of Object.keys(s.topics)) if (!SPEC_TOPICS.includes(k)) fail(`spec.topics.${k}`, `is not a topic (${SPEC_TOPICS.join(', ')})`);
}

/** @param {any} e @param {string} [where] @returns {asserts e is TraceEvent} */
export function assertTraceEvent(e, where = 'trace event') {
  if (e?.v !== 1) fail(`${where}.v`, 'must be 1');
  str(e.trace, `${where}.trace`); str(e.at, `${where}.at`); str(e.by, `${where}.by`); str(e.tool, `${where}.tool`);
  if (!Number.isInteger(e.seq) || e.seq < 1) fail(`${where}.seq`, 'must be a whole number from 1');
  if (!TRACE_KINDS.includes(e.kind)) fail(`${where}.kind`, `must be one of ${TRACE_KINDS.join(', ')}`);
  if (e.stepId !== null && typeof e.stepId !== 'string') fail(`${where}.stepId`, 'must be a string or null');
  if (e.kind === 'refusal') {
    if (!['construct', 'plan'].includes(e.source)) fail(`${where}.source`, 'must be construct or plan');
    str(e.code, `${where}.code`); sentence(e.sentence, `${where}.sentence`);
    if (!Array.isArray(e.rules) || !Array.isArray(e.files) || !Array.isArray(e.fixes)) fail(where, 'a refusal lists rules, files and fixes');
  }
  if (e.kind === 'fix-picked') str(e.fixOf, `${where}.fixOf`);
  if (e.kind === 'outcome' && (typeof e.ok !== 'boolean' || !Number.isInteger(e.passed) || !Number.isInteger(e.total))) fail(where, 'an outcome has ok, passed and total');
}

/** @param {any} p @returns {asserts p is ContextPick} */
export function assertContextPick(p) {
  if (!Array.isArray(p?.items) || !Array.isArray(p.files) || !Array.isArray(p.rules)) fail('pick', 'has items, files and rules');
  for (const f of p.files) { str(f.file, 'pick.files[].file'); sentence(f.why, `pick ${f.file}.why`); sentence(f.summary?.sentence, `pick ${f.file}.summary`); str(f.summary.via, `pick ${f.file}.summary.via`); }
  for (let i = 1; i < p.files.length; i += 1) if (p.files[i].score > p.files[i - 1].score) fail('pick.files', 'must be ranked by score');
  if (!['static', 'jev'].includes(p.via)) fail('pick.via', 'must be static or jev');
}

// ---------------------------------------------------------------------------------------------
// Expressions (System 1 groundwork) -- a step's expected output as a machine-checkable JSON expression, evaluated
// against a fixed-size facts snapshot of the project (facts.mjs), never by code: no eval, no code strings, no
// functions, and a path reads only a value's own JSON fields. expr.mjs evaluates; conditions.mjs gives each line.* tool
// its `pre` (evaluated before the step runs; a failure refuses it in one sentence) and `post` (part of its checks);
// records.mjs appends one training record per finished step: logic only, project names replaced by typed slots.
// Steps are transitions between structure states: the facts carry a delexicalized structure hash per project, feature
// and layer (structure.mjs), and a record stores the hashes before and after plus the structural delta.

/**
 * The expression language. A node is exactly one of:
 *   a literal          "text" | 3 | true | null | {"lit": <any JSON>}
 *   a path             {"path": ["files", "features/orders/components/StatusBadge.tsx", "hash"]}  into the facts
 *   an item path       {"item": ["name"]}  into the element `every` / `some` is looking at ({"item": []} is the element)
 *   a comparison       {"eq"|"ne"|"lt"|"le"|"gt"|"ge": [a, b]}
 *   logic              {"and": [e, ...]} | {"or": [e, ...]} | {"not": e}
 *   exists             {"exists": <path or item path>}   the value is there (not missing, not null)
 *   count              {"count": e}                      length of a list or text, number of fields of an object
 *   every / some       {"every"|"some": [<list>, <predicate over item>]}
 *   in                 {"in": [needle, haystack]}        list member, substring, or object field name
 * Limits: EXPR_LIMITS. Hashes are plain strings, so `eq` compares them (post: a feature's structure hash equals a
 * predicted one).
 * @typedef {null|boolean|number|string|{[op: string]: any}} LineExpr
 *
 * @typedef {object} ExprFailure
 * @property {string} path      Where in the expression, e.g. "and[1].exists" ("" for the root).
 * @property {string} sentence  Plain English: "features/orders/components/StatusBadge.tsx does not exist yet."
 *
 * @typedef {object} ExprEvaluation
 * @property {boolean} ok
 * @property {ExprFailure[]} failed  Empty exactly when ok.
 *
 * Delexicalized structure hashes ("sha256:<16 hex>"): kinds, roles (component level), layers, base links, import
 * edges between items, with every name a slot; two projects that differ only in names hash the same.
 * @typedef {object} StructureHashes
 * @property {string} project
 * @property {Record<string, {hash: string, layers: Record<string, string>}>} features  By feature name (live facts only).
 * @property {string} library
 *
 * The facts snapshot: what the project is, statically, in a fixed-size summary (capped lists, counts not content).
 * @typedef {object} LineFacts
 * @property {Record<string, {bytes: number, hash: string}>} files   Library and feature files (hash: sha256 hex, as fragments use).
 * @property {Record<string, {kind: string, name: string, file: string, level: string|null, usedBy: number}>} library  By item id.
 * @property {Record<string, {spec: boolean, items: {id: string, kind: string, name: string, file: string, base: string|null, status: string, findings: number}[]}>} features  By feature name.
 * @property {{key: string, rule: string, severity: string, file: string, fixIds: string[]}[]} findings
 * @property {{key: string, rule: string, severity: string, file: string}[]} findingsNew  New errors the last write met (empty before a write).
 * @property {{tool: string, staged: boolean, applied: boolean|null, files: {path: string, asPlanned: boolean}[]}|null} plan  The step being checked.
 * @property {StructureHashes} structure
 * @property {{files: number, findings: number}} truncated  How many entries the caps left out.
 *
 * One training record per finished step (append-only JSONL, `<state>/records/plans.jsonl`). Logic only: every project
 * name (feature, item, library id, file, finding key, argument value) is a typed slot like "<feature:F1>" or
 * "<item:I2 kind=components>", exprs are stored over the slots, and the live plan keeps the real names.
 * @typedef {object} PlanRecord
 * @property {1} v
 * @property {string} at
 * @property {string} intent        The plan's goal, slotted.
 * @property {string} facts         "sha256:<16 hex>" of the facts summary before the step ran.
 * @property {{project: string, library: string, features: Record<string, string>}} before  Structure hashes (feature keys slotted).
 * @property {{project: string, library: string, features: Record<string, string>}} after
 * @property {{added: string[], removed: string[], changed: string[]}} delta  Structural delta as slotted item lines, e.g. "<feature:F1>/components/<item:I1 kind=components> base=<lib:L1>".
 * @property {{tool: string, args: Record<string, unknown>}[]} steps  The plan's steps up to this one, slotted.
 * @property {number} step          Which of `steps` finished (1-based).
 * @property {{id: string, kind: string, expr: LineExpr|null, ok: boolean}[]} checks
 * @property {number} passed
 * @property {{expr: LineExpr|null, ok: boolean}|null} pre
 * @property {boolean} approved     A person approved the step.
 * @property {boolean} repaired     The step is a retry or a fix of a step that needed the person.
 * @property {Record<string, string>} slots  Slot -> what it stands for in logic terms (its kind, never the name).
 */

/** Every operator of the language. */
export const EXPR_OPS = Object.freeze(['lit', 'path', 'item', 'eq', 'ne', 'lt', 'le', 'gt', 'ge', 'and', 'or', 'not', 'exists', 'count', 'every', 'some', 'in']);
/** The language's limits. */
export const EXPR_LIMITS = Object.freeze({ depth: 24, nodes: 400, segments: 16, string: 2000, operands: 100 });
/** The facts snapshot's caps (fixed size). */
export const FACTS_LIMITS = Object.freeze({ files: 2000, findings: 500 });
/** The facts snapshot's top-level fields. */
export const FACTS_FIELDS = Object.freeze(['files', 'library', 'features', 'findings', 'findingsNew', 'plan', 'structure', 'truncated']);
/** A slot in a training record: <kind:Xn attr=value ...>. */
export const SLOT_PATTERN = /^<[a-z]+:[A-Z]\d+( [a-z]+=[A-Za-z0-9_-]+)*>$/;
const HASH16 = /^sha256:[0-9a-f]{16}$/;

const COMPARE = new Set(['eq', 'ne', 'lt', 'le', 'gt', 'ge']);
const isPlain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
/** Plain JSON only: no functions, dates, class instances, undefined or non-finite numbers. */
const isJson = (v, d) => {
  if (d > EXPR_LIMITS.depth) return false;
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (Array.isArray(v)) return v.every((x) => isJson(x, d + 1));
  return isPlain(v) && Object.values(v).every((x) => isJson(x, d + 1));
};
const pathProblem = (segs, at, op) => {
  if (!Array.isArray(segs)) return `In ${at}, "${op}" takes a list of names, like {"${op}": ["files", "a.tsx"]}.`;
  if (segs.length > EXPR_LIMITS.segments) return `In ${at}, a path has at most ${EXPR_LIMITS.segments} parts.`;
  if (op === 'path' && segs.length === 0) return `In ${at}, a path names at least one part, like ["files"].`;
  for (const s of segs) {
    if (!(typeof s === 'string' && s.length > 0 && s.length <= EXPR_LIMITS.string) && !(Number.isInteger(s) && s >= 0)) return `In ${at}, each part of a path is a name or a list position (a whole number from 0).`;
  }
  return null;
};

/**
 * Why `expr` is not a valid expression, in one sentence, or null when it is.
 * @param {unknown} expr
 * @returns {string|null}
 */
export function exprProblem(expr) {
  let nodes = 0;
  /** @returns {string|null} */
  const walk = (e, where, depth, inItem) => {
    nodes += 1;
    const here = where ? `In ${where}, ` : '';
    if (nodes > EXPR_LIMITS.nodes) return `The expression has more than ${EXPR_LIMITS.nodes} parts; split it into several checks.`;
    if (depth > EXPR_LIMITS.depth) return `The expression nests deeper than ${EXPR_LIMITS.depth} levels.`;
    if (e === null || typeof e === 'boolean') return null;
    if (typeof e === 'number') return Number.isFinite(e) ? null : `${here}a number must be finite.`;
    if (typeof e === 'string') return e.length <= EXPR_LIMITS.string ? null : `${here}a text is at most ${EXPR_LIMITS.string} characters.`;
    if (typeof e === 'function') return `${here}a function is not an expression; expressions are plain JSON.`;
    if (Array.isArray(e)) return `${here}a bare list is not an expression; write {"lit": [...]} for a list value.`;
    if (!isPlain(e)) return `${here}only plain JSON values are expressions.`;
    const keys = Object.keys(e);
    if (keys.length !== 1) return `${here}an expression object has exactly one operator, not ${keys.length ? keys.join(', ') : 'none'}.`;
    const [op] = keys; const a = e[op]; const at = where ? `${where}.${op}` : op;
    if (!EXPR_OPS.includes(op)) return `${here}"${op}" is not an operator; use one of ${EXPR_OPS.join(', ')}.`;
    if (op === 'lit') return isJson(a, 0) && JSON.stringify(a).length <= EXPR_LIMITS.string * 4 ? null : `In ${at}, a literal must be plain JSON.`;
    if (op === 'path') return pathProblem(a, at, op);
    if (op === 'item') return inItem ? pathProblem(a, at, op) : `In ${at}, "item" only means something inside every or some.`;
    if (op === 'not' || op === 'count') return walk(a, at, depth + 1, inItem);
    if (op === 'exists') {
      if (!isPlain(a) || Object.keys(a).length !== 1 || !(('path' in a) || ('item' in a))) return `In ${at}, exists takes a path, like {"exists": {"path": ["files", "a.tsx"]}}.`;
      return walk(a, at, depth + 1, inItem);
    }
    if (!Array.isArray(a)) return `In ${at}, "${op}" takes a list of expressions.`;
    if (a.length > EXPR_LIMITS.operands) return `In ${at}, "${op}" takes at most ${EXPR_LIMITS.operands} expressions.`;
    if ((COMPARE.has(op) || op === 'in' || op === 'every' || op === 'some') && a.length !== 2) return `In ${at}, "${op}" takes exactly two expressions.`;
    if ((op === 'and' || op === 'or') && a.length === 0) return `In ${at}, "${op}" takes at least one expression.`;
    for (let i = 0; i < a.length; i += 1) {
      const why = walk(a[i], `${at}[${i}]`, depth + 1, (op === 'every' || op === 'some') && i === 1 ? true : inItem);
      if (why) return why;
    }
    return null;
  };
  const why = walk(expr, '', 0, false);
  return why && why.charAt(0).toUpperCase() + why.slice(1);
}

/**
 * Throws unless e is a valid expression; the TypeError's message is the one-sentence reason.
 * @param {unknown} e
 * @returns {asserts e is LineExpr}
 */
export function assertExpr(e) {
  const why = exprProblem(e);
  if (why) throw new TypeError(why);
}

/** The JSON Schema of an expression (exprProblem also checks depth, size and where `item` may appear). */
export const EXPR_JSON_SCHEMA = Object.freeze({
  $id: 'line/expr.schema.json',
  description: 'A Line expression: a literal or an object with exactly one operator (packages/engine/line/contract.mjs LineExpr).',
  oneOf: [
    { type: ['string', 'number', 'boolean', 'null'] },
    {
      type: 'object', minProperties: 1, maxProperties: 1, additionalProperties: false,
      properties: Object.fromEntries(EXPR_OPS.map((op) => [op,
        op === 'path' || op === 'item' ? { type: 'array', maxItems: EXPR_LIMITS.segments, items: { oneOf: [{ type: 'string', minLength: 1 }, { type: 'integer', minimum: 0 }] } }
          : op === 'lit' ? {}
            : op === 'not' || op === 'count' || op === 'exists' ? { $ref: 'line/expr.schema.json' }
              : { type: 'array', minItems: 1, maxItems: EXPR_LIMITS.operands, items: { $ref: 'line/expr.schema.json' } }])),
    },
  ],
});

/**
 * Throws unless r is an ExprEvaluation (ok exactly when nothing failed; each failure one sentence).
 * @param {any} r
 * @returns {asserts r is ExprEvaluation}
 */
export function assertExprEvaluation(r) {
  if (typeof r?.ok !== 'boolean' || !Array.isArray(r.failed)) fail('evaluation', 'has ok and failed');
  if (r.ok !== (r.failed.length === 0)) fail('evaluation.ok', 'is true exactly when nothing failed');
  r.failed.forEach((f, i) => { if (typeof f.path !== 'string') fail(`evaluation.failed[${i}].path`, 'must be a string'); sentence(f.sentence, `evaluation.failed[${i}].sentence`); });
}

/**
 * Throws unless f is a LineFacts snapshot within its caps.
 * @param {any} f
 * @returns {asserts f is LineFacts}
 */
export function assertLineFacts(f) {
  if (!isPlain(f)) fail('facts', 'must be an object');
  for (const k of FACTS_FIELDS) if (!(k in f)) fail(`facts.${k}`, 'is missing');
  if (!isPlain(f.files) || !isPlain(f.library) || !isPlain(f.features)) fail('facts', 'files, library and features are objects');
  if (Object.keys(f.files).length > FACTS_LIMITS.files) fail('facts.files', `holds at most ${FACTS_LIMITS.files} files`);
  for (const [p, v] of Object.entries(f.files)) if (!Number.isInteger(v?.bytes) || !/^[0-9a-f]{64}$/.test(String(v.hash))) fail(`facts.files[${p}]`, 'has bytes and a sha256 hash');
  if (!Array.isArray(f.findings) || f.findings.length > FACTS_LIMITS.findings) fail('facts.findings', `must be a list of at most ${FACTS_LIMITS.findings}`);
  for (const x of f.findings) { str(x.key, 'facts.findings[].key'); str(x.rule, 'facts.findings[].rule'); if (!Array.isArray(x.fixIds)) fail('facts.findings[].fixIds', 'must be a list'); }
  if (!Array.isArray(f.findingsNew)) fail('facts.findingsNew', 'must be a list');
  for (const [n, feat] of Object.entries(f.features)) if (typeof feat?.spec !== 'boolean' || !Array.isArray(feat.items)) fail(`facts.features.${n}`, 'has spec and items');
  if (f.plan !== null && (typeof f.plan?.tool !== 'string' || typeof f.plan.staged !== 'boolean' || !Array.isArray(f.plan.files))) fail('facts.plan', 'is null or {tool, staged, applied, files}');
  const s = f.structure;
  if (!HASH16.test(String(s?.project)) || !HASH16.test(String(s.library)) || !isPlain(s.features)) fail('facts.structure', 'has project, library and features hashes');
  for (const [n, h] of Object.entries(s.features)) if (!HASH16.test(String(h?.hash)) || !isPlain(h.layers)) fail(`facts.structure.features.${n}`, 'has a hash and layer hashes');
  if (!Number.isInteger(f.truncated?.files) || !Number.isInteger(f.truncated?.findings)) fail('facts.truncated', 'counts files and findings left out');
}

const assertHashes = (h, where) => {
  if (!HASH16.test(String(h?.project)) || !HASH16.test(String(h.library)) || !isPlain(h.features)) fail(where, 'has project, library and features hashes');
  for (const [k, v] of Object.entries(h.features)) { if (!SLOT_PATTERN.test(k)) fail(`${where}.features`, `"${k}" is not a slot`); if (!HASH16.test(String(v))) fail(`${where}.features.${k}`, 'must be a hash'); }
};

/**
 * Throws unless r is a PlanRecord whose names are all typed slots.
 * @param {any} r
 * @param {string} [where]
 * @returns {asserts r is PlanRecord}
 */
export function assertPlanRecord(r, where = 'record') {
  if (r?.v !== 1) fail(`${where}.v`, 'must be 1');
  str(r.at, `${where}.at`);
  if (typeof r.intent !== 'string') fail(`${where}.intent`, 'must be a string');
  if (!HASH16.test(String(r.facts))) fail(`${where}.facts`, 'must be "sha256:" and 16 hex digits');
  assertHashes(r.before, `${where}.before`); assertHashes(r.after, `${where}.after`);
  if (!Array.isArray(r.delta?.added) || !Array.isArray(r.delta.removed) || !Array.isArray(r.delta.changed)) fail(`${where}.delta`, 'has added, removed and changed');
  if (!Array.isArray(r.steps) || !r.steps.length) fail(`${where}.steps`, 'must list the plan steps');
  r.steps.forEach((s, i) => { str(s?.tool, `${where}.steps[${i}].tool`); if (!isPlain(s.args)) fail(`${where}.steps[${i}].args`, 'must be an object'); });
  if (!Number.isInteger(r.step) || r.step < 1 || r.step > r.steps.length) fail(`${where}.step`, 'must point into steps');
  if (!Array.isArray(r.checks)) fail(`${where}.checks`, 'must be a list');
  r.checks.forEach((c, i) => { str(c.id, `${where}.checks[${i}].id`); if (typeof c.ok !== 'boolean') fail(`${where}.checks[${i}].ok`, 'must be a boolean'); if (c.expr !== null) assertExpr(c.expr); });
  if (r.passed !== r.checks.filter((c) => c.ok).length) fail(`${where}.passed`, 'must count the passing checks');
  if (r.pre !== null && typeof r.pre?.ok !== 'boolean') fail(`${where}.pre`, 'is null or {expr, ok}');
  if (typeof r.approved !== 'boolean') fail(`${where}.approved`, 'must be a boolean');
  if (typeof r.repaired !== 'boolean') fail(`${where}.repaired`, 'must be a boolean');
  if (!isPlain(r.slots)) fail(`${where}.slots`, 'must be an object');
  for (const k of Object.keys(r.slots)) if (!SLOT_PATTERN.test(k)) fail(`${where}.slots`, `"${k}" is not a slot`);
}
