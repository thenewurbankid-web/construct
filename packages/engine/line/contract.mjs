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
 * @property {string} [key]     Stable handle for a line.fix plan step: "<rule>|<file>|<line>" (fixes.mjs findingKey).
 * @property {LineFix[]} [fixes] Typed fixes (fixes.mjs fixesFor), recommended first; absent on findings that are not LINE-*.
 */

/**
 * The Line tools a fix step may call (each one is a pure planner returning a StagedChange; fixes.mjs planStep):
 *   line.setBase      {file, libraryId}          rewrite the item's base link (the line-base header, or "$lineBase" in JSON) to one library item
 *   line.promote      PromoteRequest             move a feature item into the library and re-point its users (ops.mjs planPromote)
 *   line.baseOn       BaseOnRequest              create a feature item based on a library item (ops.mjs planBaseOn)
 *   line.moveFile     {from, to, base?}          move a file, re-pointing every import; `base` also writes its line-base header
 *   line.createLayout {}                         create the library folder (library/README.md) so the project is laid out as Line
 *   line.amend        {change, fix} | {change, fixes}  a refused change plus its fix (or a chain of fixes), applied as one change
 * @typedef {'line.setBase'|'line.promote'|'line.baseOn'|'line.moveFile'|'line.createLayout'|'line.amend'} LineFixTool
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

/**
 * POST /api/line/new-project: start a new Line project (newProject.mjs). `parentDir` is an existing folder inside the
 * Cockpit workspace (absolute, or relative to the workspace root; "" is the workspace root itself); `name` is the new
 * folder (one segment: letters, digits, "-", "_" and inner dots); `firstFeature` the one empty feature it starts with.
 * Needs no open project; on success the server opens the new one.
 * @typedef {{parentDir: string, name: string, firstFeature: string}} NewLineProjectRequest
 */

/**
 * What creating a Line project answers: the ApplyResult of the starter files (written through the writer into the new
 * folder, gated by the Line validate profile), plus the new folder's absolute path (null when refused; nothing is kept).
 * @typedef {ApplyResult & {dir: string|null}} NewLineProjectResult
 */

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
 * @property {(req: NewLineProjectRequest) => StagedChange} planNewLineProject  The starter files, root-relative to the new folder (pure).
 * @property {(parentDir: string, req: NewLineProjectRequest) => NewLineProjectResult} createLineProject  Make `<parentDir>/<name>` and apply the plan there; throws LineOpError BAD_NAME, BAD_FEATURE, NO_PARENT or NAME_TAKEN, writing nothing.
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
 * When the fix names a file only the refused change creates, `step` is one `line.amend` step {change, fix}: the refused
 * change and the fix planned together and applied atomically (fixes.mjs planAmended); once it lands, the refused step
 * counts as done. Every fix with a step was tried on a scratch copy through the writer and would land (cl1); a promote
 * blocked by the item's own feature dependencies is offered as the chain {change, fixes: [promote the dependency, promote
 * the item]} in one step. A fix that would be refused has step null and says why; with none left, the step is needs-you.
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
 * @property {string} [recheck]  POST /plan/run after a fix step (args.fixOf) landed: whether the step it fixed plans clean
 *   now (then a retry of it waits for approval) or still cannot land, in one sentence.
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
  { name: 'line.import.mark', kind: 'write', request: '{folder, features}' },
  { name: 'line.import.toLibrary', kind: 'write', request: '{folder, from, kind, name, level?, keepShim?}' },
  { name: 'line.import.toFeature', kind: 'write', request: '{folder, mode, from?, kind, name, feature, base, keepShim?, route?}' },
  { name: 'line.amend', kind: 'write', request: '{change: {tool, args}, fix: {tool, args}} or {change, fixes: [{tool, args}, ...]}' },
  { name: 'line.leaveAsIs', kind: 'write', request: '{stepId}' },
  { name: 'line.project', kind: 'read', request: '{}' },
]);
export const CHECK_KINDS = Object.freeze(['validate', 'types', 'tests', 'file', 'spec']);
// ---------------------------------------------------------------------------------------------
// Import (ci1, packages/engine/line/import.mjs): bring one folder of an app not built with Line into Line's layout.
// Partial migration: the open project is the source; only the chosen folder is ever written (it becomes a small Line
// project of its own: architecture.yml with `preset: line`, <folder>/library, <folder>/features/<name>); the rest of
// the project is read (to see who uses what and which routes serve which page) and never changed.

/**
 * One item the scan found inside the folder, with what Line proposes for it.
 * @typedef {object} ImportFound
 * @property {string} file        Project-relative path (where it is today).
 * @property {LineKind} kind
 * @property {string} name        The item's name (its main export, else the file name).
 * @property {{target: 'library'|'feature', feature?: string, base?: string, level?: Level, route?: string, sentence: string}} proposal
 *   `feature` and `base` for a feature item (`base` is the library id it will be based on); `level` for a library
 *   component; `route` for a page an app route serves. `sentence` says it all in plain English.
 * @property {'sure'|'ask'} confidence  "ask" when two static rules disagree; the matching question says how.
 * @property {string[]} rules     The static rules that decided it (ids for a Details view, e.g. "used-by-pages").
 * @property {string[]} usedBy    Project-relative files that import it (inside and outside the folder).
 */

/**
 * A question the scan cannot decide by itself (two rules disagree). Options are closed, with stable ids.
 * @typedef {object} ImportQuestion
 * @property {string} id          Stable: "<rule>:<file>".
 * @property {string} file        The item it is about.
 * @property {string} sentence    The question in plain English.
 * @property {{id: string, sentence: string}[]} options
 * @property {string} recommended An option id (listed first).
 */

/**
 * POST /api/line/import/scan {folder}: what Line found in the folder and proposes (pure read, no model).
 * @typedef {object} ImportScan
 * @property {string} sourceRoot  The open project (absolute).
 * @property {string} folder      Project-relative folder that will be written.
 * @property {ImportFound[]} found
 * @property {ImportQuestion[]} questions
 * @property {{file: string, sentence: string}[]} unchanged  Files in the folder that stay as they are (types, constants, tests).
 * @property {string[]} routes    Every route Line read in the project, as "<path> -> <file>" (Details).
 */

/**
 * One plan-ready step: a Line operation that produces a StagedChange, applied through applyChange. Import steps run
 * with the folder as the root (`<project>/<args.folder>`), so a step can never write outside it.
 * @typedef {object} ImportStep
 * @property {string} id          Stable: "import-<n>-<slug>".
 * @property {'line.import.mark'|'line.import.toLibrary'|'line.import.toFeature'} tool
 * @property {Record<string, unknown>} args  JSON; always includes `folder`.
 * @property {string} sentence    What the step does, in plain English.
 */

/**
 * POST /api/line/import/plan {folder, answers}: the proposals turned into steps (pure, nothing written).
 * @typedef {object} ImportPlan
 * @property {string} folder
 * @property {string} summary     One sentence.
 * @property {ImportStep[]} steps
 */

/**
 * applyImport {folder, answers} (CLI and mock mode; Cockpit adds the steps to the plan): the plan run step by step through applyChange; it stops at the first
 * refused step (steps already landed stay landed, each one was checked on its own).
 * @typedef {object} ImportApplyResult
 * @property {boolean} ok
 * @property {string} sentence
 * @property {string[]} files     Project-relative files written.
 * @property {LineFinding[]} findings  Why a step was refused (empty when every step landed).
 * @property {{id: string, ok: boolean, sentence: string}[]} steps
 */

/** @typedef {{folder: string}} ImportScanRequest */
/** @typedef {{folder: string, answers?: Record<string, string>}} ImportPlanRequest */
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
  { method: 'GET', path: '/api/line/render', request: 'file, props (query)', response: 'RenderResult' },
  { method: 'GET', path: '/api/line/feature', request: 'name (query)', response: 'LineFeatureDetail' },
  { method: 'GET', path: '/api/line/workspace', request: null, response: 'LineWorkspace' },
  { method: 'POST', path: '/api/line/workspace', request: 'WorkspaceRequest', response: 'LineWorkspace' },
  { method: 'GET', path: '/api/line/fragments', request: 'file (query)', response: 'FragmentList' },
  // cp1: every change to the project is a plan step (line.baseOn, line.promote, line.setPageProp, line.fix, line.setFragment,
  // line.import.*); approve and run need the Cockpit page's Origin and the x-line-approval token GET /plan hands it.
  { method: 'GET', path: '/api/line/plan', request: null, response: 'PlanView & {approvalToken}' },
  { method: 'POST', path: '/api/line/plan/step', request: 'PlanStepRequest', response: 'PlanView & {stepId}' },
  { method: 'POST', path: '/api/line/plan/approve', request: '{stepId} | {stepIds}', response: 'PlanView' },
  { method: 'POST', path: '/api/line/plan/run', request: '{stepId?}', response: 'PlanView' },
  { method: 'GET', path: '/api/line/import/folders', request: null, response: '{sourceRoot, folders: {path, files}[]}' },
  { method: 'POST', path: '/api/line/import/scan', request: 'ImportScanRequest', response: 'ImportScan' },
  { method: 'POST', path: '/api/line/import/plan', request: 'ImportPlanRequest', response: 'ImportPlan' },
  { method: 'POST', path: '/api/line/new-project', request: 'NewLineProjectRequest', response: 'NewLineProjectResult' },
]);

/** The tools an import plan's steps name (plan-ready: each produces a StagedChange for applyChange). */
export const IMPORT_TOOLS = Object.freeze(['line.import.mark', 'line.import.toLibrary', 'line.import.toFeature']);

export const LINE_FIX_TOOLS = Object.freeze(['line.setBase', 'line.promote', 'line.baseOn', 'line.moveFile', 'line.createLayout', 'line.amend']);

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
 * Throws unless r is a NewLineProjectResult (an ApplyResult plus the new project's folder, null when not created).
 * @param {any} r
 * @returns {asserts r is NewLineProjectResult}
 */
export function assertNewLineProjectResult(r) {
  /** @type {any} */
  const x = r;
  assertApplyResult(x);
  const y = /** @type {any} */ (r);
  if (y.ok) str(y.dir, 'result.dir');
  else if (y.dir !== null) fail('result.dir', 'is null when the project was not created');
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

/**
 * Throws unless c is a plan check (id, one sentence, a known kind).
 * @param {any} c
 * @param {string} [where] Where in the value the check sits, for the error.
 * @returns {void}
 */
export function assertPlanCheck(c, where = 'check') {
  str(c?.id, `${where}.id`);
  sentence(c.sentence, `${where}.sentence`);
  if (!CHECK_KINDS.includes(c.kind)) fail(`${where}.kind`, `must be one of ${CHECK_KINDS.join(', ')}`);
}

/**
 * Throws unless r is a LineStepResult (apply result, checks, counts and options that agree).
 * @param {any} r
 * @returns {asserts r is LineStepResult}
 */
export function assertLineStepResult(r) {
  assertApplyResult(r?.apply);
  if (!Array.isArray(r.checks)) fail('stepResult.checks', 'must be an array');
  r.checks.forEach((c, i) => { str(c.checkId, `stepResult.checks[${i}].checkId`); if (typeof c.ok !== 'boolean') fail(`stepResult.checks[${i}].ok`, 'must be a boolean'); sentence(c.sentence, `stepResult.checks[${i}].sentence`); });
  if (r.passed !== r.checks.filter((c) => c.ok).length || r.total !== r.checks.length) fail('stepResult.passed', 'must count the passing checks');
  if (r.needsYou !== r.passed < r.total) fail('stepResult.needsYou', 'is true exactly when a check failed');
  if (r.needsYou && !r.options.length) fail('stepResult.options', 'a step that needs you offers options');
  sentence(r.sentence, 'stepResult.sentence');
}

/**
 * Throws unless v is a PlanView (session, steps with state, sentence and gap, store status).
 * @param {any} v
 * @returns {asserts v is PlanView}
 */
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

const relPath = (v, where) => { str(v, where); if (v.startsWith('/') || v.split('/').includes('..')) fail(where, 'must be project-relative and stay inside the project'); };

/**
 * Throws unless s is an ImportScan (found items, questions, unchanged files and routes, all inside the folder).
 * @param {any} s
 * @returns {asserts s is ImportScan}
 */
export function assertImportScan(s) {
  str(s?.sourceRoot, 'scan.sourceRoot');
  relPath(s.folder, 'scan.folder');
  if (!Array.isArray(s.found) || !Array.isArray(s.questions) || !Array.isArray(s.unchanged) || !Array.isArray(s.routes)) fail('scan', 'found, questions, unchanged and routes must be arrays');
  const qFiles = new Set();
  s.questions.forEach((q, i) => {
    const w = `scan.questions[${i}]`;
    str(q.id, `${w}.id`);
    relPath(q.file, `${w}.file`);
    sentence(q.sentence, `${w}.sentence`);
    if (!Array.isArray(q.options) || q.options.length < 2) fail(`${w}.options`, 'a question offers at least two options');
    q.options.forEach((o, j) => { str(o.id, `${w}.options[${j}].id`); sentence(o.sentence, `${w}.options[${j}].sentence`); });
    if (q.options[0].id !== q.recommended) fail(`${w}.recommended`, 'must be the first option');
    qFiles.add(q.file);
  });
  s.found.forEach((f, i) => {
    const w = `scan.found[${i}]`;
    relPath(f.file, w + '.file');
    if (!f.file.startsWith(`${s.folder}/`)) fail(`${w}.file`, 'must be inside the folder');
    if (!LINE_KINDS.includes(f.kind)) fail(`${w}.kind`, 'unknown kind');
    str(f.name, `${w}.name`);
    const p = f.proposal;
    if (!['library', 'feature'].includes(p?.target)) fail(`${w}.proposal.target`, 'must be library or feature');
    if (p.target === 'feature') { str(p.feature, `${w}.proposal.feature`); str(p.base, `${w}.proposal.base`); }
    sentence(p.sentence, `${w}.proposal.sentence`);
    if (!['sure', 'ask'].includes(f.confidence)) fail(`${w}.confidence`, 'must be sure or ask');
    if ((f.confidence === 'ask') !== qFiles.has(f.file)) fail(`${w}.confidence`, 'is "ask" exactly when a question is about it');
    if (!Array.isArray(f.rules) || !Array.isArray(f.usedBy)) fail(w, 'rules and usedBy must be arrays');
  });
  s.unchanged.forEach((u, i) => { relPath(u.file, `scan.unchanged[${i}].file`); sentence(u.sentence, `scan.unchanged[${i}].sentence`); });
}

/**
 * Throws unless p is an ImportPlan (unique import steps, each naming the plan's folder).
 * @param {any} p
 * @returns {asserts p is ImportPlan}
 */
export function assertImportPlan(p) {
  relPath(p?.folder, 'plan.folder');
  sentence(p.summary, 'plan.summary');
  if (!Array.isArray(p.steps)) fail('plan.steps', 'must be an array');
  const ids = new Set();
  p.steps.forEach((st, i) => {
    const w = `plan.steps[${i}]`;
    str(st.id, `${w}.id`);
    if (ids.has(st.id)) fail(`${w}.id`, 'must be unique');
    ids.add(st.id);
    if (!IMPORT_TOOLS.includes(st.tool)) fail(`${w}.tool`, `must be one of ${IMPORT_TOOLS.join(', ')}`);
    if (st.args?.folder !== p.folder) fail(`${w}.args.folder`, 'must name the plan\'s folder');
    sentence(st.sentence, `${w}.sentence`);
  });
}

/**
 * Throws unless r is an ImportApplyResult (an ApplyResult plus one sentence per step).
 * @param {any} r
 * @returns {asserts r is ImportApplyResult}
 */
export function assertImportApplyResult(r) {
  /** @type {any} */
  const x = r;
  assertApplyResult(x);
  const y = /** @type {any} */ (r);
  if (!Array.isArray(y.steps)) fail('result.steps', 'must be an array');
  y.steps.forEach((st, i) => { str(st.id, `result.steps[${i}].id`); sentence(st.sentence, `result.steps[${i}].sentence`); });
  if (y.ok && y.steps.some((st) => !st.ok)) fail('result', 'ok only when every step landed');
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

/**
 * Throws unless s is a LineSpec (format, version and every topic).
 * @param {any} s
 * @returns {asserts s is LineSpec}
 */
export function assertLineSpec(s) {
  if (s?.format !== SPEC_FORMAT) fail('spec.format', `must be ${SPEC_FORMAT}`);
  if (!/^sha256:[0-9a-f]{16}$/.test(String(s.version))) fail('spec.version', 'must be "sha256:" and 16 hex digits');
  str(s.construct, 'spec.construct');
  if (!s.topics || typeof s.topics !== 'object') fail('spec.topics', 'must be an object');
  for (const k of Object.keys(s.topics)) if (!SPEC_TOPICS.includes(k)) fail(`spec.topics.${k}`, `is not a topic (${SPEC_TOPICS.join(', ')})`);
}

/**
 * Throws unless e is a TraceEvent (version 1, a known kind and that kind's fields).
 * @param {any} e
 * @param {string} [where] Where the event sits, for the error.
 * @returns {asserts e is TraceEvent}
 */
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

/**
 * Throws unless p is a ContextPick (items, files and rules).
 * @param {any} p
 * @returns {asserts p is ContextPick}
 */
export function assertContextPick(p) {
  if (!Array.isArray(p?.items) || !Array.isArray(p.files) || !Array.isArray(p.rules)) fail('pick', 'has items, files and rules');
  for (const f of p.files) { str(f.file, 'pick.files[].file'); sentence(f.why, `pick ${f.file}.why`); sentence(f.summary?.sentence, `pick ${f.file}.summary`); str(f.summary.via, `pick ${f.file}.summary.via`); }
  for (let i = 1; i < p.files.length; i += 1) if (p.files[i].score > p.files[i - 1].score) fail('pick.files', 'must be ranked by score');
  if (!['static', 'jev'].includes(p.via)) fail('pick.via', 'must be static or jev');
}
