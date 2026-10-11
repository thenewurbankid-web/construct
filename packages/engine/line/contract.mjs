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
 * @property {(root: string, feature: string) => LineWorkflowList} readLineWorkflows  cw1 (workflows.mjs)
 * @property {(root: string, req: BaseWorkflowOnRequest) => StagedChange} planBaseWorkflowOn
 * @property {(root: string, req: SetWorkflowRoleRequest) => StagedChange} planSetWorkflowRole
 * @property {(root: string, req: AddWorkflowTransitionRequest) => StagedChange} planAddWorkflowTransition
 * @property {(root: string, req: RemoveWorkflowTransitionRequest) => StagedChange} planRemoveWorkflowTransition
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
 * cw1 -- Line workflows: state machines between pages, used like primitives (packages/engine/line/workflows.mjs; the
 * words in workflowWords.mjs). A LIBRARY workflow is a complete xstate machine in `<library>/workflows/` with
 * `export const roles = { <state>: '<what that page is for>' }`: each role is a state that a page fills. A FEATURE
 * workflow (`<features>/<f>/workflows/<name>.ts`) is based on one library workflow (`// @line-base workflows/<name>`):
 * a copy of its machine with `export const pages = { <role>: '<PageName>' | null }` naming which page of the feature
 * fills each role, plus only the transitions the feature adds. States are pages (a filled role) or steps; triggers are
 * a page's events; actions go to a state (navigate), call a service or set a part's state.
 *
 * One action of a transition (an xstate parameterised action `{type, params}`; anything else is `other`).
 * @typedef {{kind: 'callService', service: string} | {kind: 'setPartState', part: string, state: string} | {kind: 'other', name: string}} LineWorkflowAction
 *
 * A role of a workflow: a state a page fills.
 * @typedef {object} LineWorkflowRole
 * @property {string} id       The state's name, e.g. "list".
 * @property {string} says     What the page is for, as the library wrote it, e.g. "The page that lists the items".
 * @property {string|null} page The feature page that fills it (its name, e.g. "OrdersPage"); null when not chosen (always null in the library).
 * @property {boolean} pageOk  False when `page` names no page of the feature.
 *
 * @typedef {object} LineWorkflowState
 * @property {string} id       The state's path, e.g. "list" or "checkout.paying".
 * @property {string} label    Plain English: the page that fills it, "the list page" when not chosen yet, or the step's name.
 * @property {string|null} role
 * @property {string|null} page
 * @property {boolean} initial
 * @property {boolean} final
 *
 * One transition as a When -> Do card.
 * @typedef {object} LineWorkflowTransition
 * @property {string} id       "<from>|<event>" (unique per machine for plain `on` transitions).
 * @property {string} from
 * @property {string} event
 * @property {string|null} to  The target state's path; null for a transition that stays.
 * @property {LineWorkflowAction[]} actions
 * @property {'library'|'feature'} origin  `library`: it is in the library workflow (or this IS the library); `feature`: the feature added it.
 * @property {boolean} removable  Only a feature's own transitions can be removed.
 * @property {string} when     "When OrdersPage sends OPEN."
 * @property {string} do       "Go to OrderDetailPage."
 *
 * @typedef {object} LineWorkflow
 * @property {string} id        "workflows/<name>" (library) or "<feature>/workflows/<name>" (feature), as the project's item ids.
 * @property {'library'|'feature'} kind
 * @property {string} name
 * @property {string} file      Root-relative.
 * @property {string|null} feature
 * @property {{value: string|null, libraryId: string|null}|null} base  Feature workflows only.
 * @property {string} machineId
 * @property {string|null} initial
 * @property {LineWorkflowRole[]} roles
 * @property {LineWorkflowState[]} states
 * @property {LineWorkflowTransition[]} transitions
 * @property {string[]} summary  Plain-English sentences (static, no model).
 * @property {{feature: string, file: string}[]} usedBy  Library workflows: the feature workflows based on it.
 *
 * GET /api/line/workflows?feature=<name>: the feature's workflows, the library's workflows to base one on, the
 * feature's pages (to fill roles) and every workflow file Cockpit cannot draw (not a plain xstate machine), each with
 * one sentence. Unknown feature: LineOpError UNKNOWN_ITEM (400).
 * @typedef {object} LineWorkflowList
 * @property {string} feature
 * @property {LineWorkflow[]} workflows
 * @property {LineWorkflow[]} library
 * @property {string[]} pages   The feature's page names.
 * @property {{id: string, file: string, sentence: string}[]} notMachines
 *
 * Requests of the workflow plan tools (all are write steps a person approves in the Plan panel):
 * @typedef {{libraryId: string, feature: string, name: string}} BaseWorkflowOnRequest  line.baseWorkflowOn
 * @typedef {{file: string, role: string, page: string}} SetWorkflowRoleRequest  line.setWorkflowRole ('' clears the role)
 * @typedef {{file: string, from: string, event: string, to: string, service?: string, part?: string, partState?: string}} AddWorkflowTransitionRequest  line.addWorkflowTransition
 * @typedef {{file: string, from: string, event: string}} RemoveWorkflowTransitionRequest  line.removeWorkflowTransition (a feature's own transitions only)
 * Promoting a feature workflow to the library is line.promote (PromoteRequest), as for every other kind.
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
  { name: 'line.baseWorkflowOn', kind: 'write', request: 'BaseWorkflowOnRequest' },
  { name: 'line.setWorkflowRole', kind: 'write', request: 'SetWorkflowRoleRequest' },
  { name: 'line.addWorkflowTransition', kind: 'write', request: 'AddWorkflowTransitionRequest' },
  { name: 'line.removeWorkflowTransition', kind: 'write', request: 'RemoveWorkflowTransitionRequest' },
  { name: 'line.leaveAsIs', kind: 'write', request: '{stepId}' },
  { name: 'line.project', kind: 'read', request: '{}' },
]);
export const CHECK_KINDS = Object.freeze(['validate', 'types', 'tests', 'file', 'spec']);

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
  { method: 'GET', path: '/api/line/workflows', request: 'feature (query)', response: 'LineWorkflowList' },
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

/** @param {any} c @param {string} [where] */
export function assertPlanCheck(c, where = 'check') {
  str(c?.id, `${where}.id`);
  sentence(c.sentence, `${where}.sentence`);
  if (!CHECK_KINDS.includes(c.kind)) fail(`${where}.kind`, `must be one of ${CHECK_KINDS.join(', ')}`);
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
    if (!['waiting', 'ready', 'running', 'done', 'needs-you', 'needs-fix', 'failed', 'skipped'].includes(s.state)) fail(`step ${s.id}.state`, 'unknown state');
    for (const g of s.gap) { if (!['present', 'partial', 'missing'].includes(g.state)) fail(`step ${s.id}.gap`, 'unknown state'); sentence(g.sentence, `step ${s.id}.gap.sentence`); }
    if (s.result && s.kind === 'write' && s.tool !== 'line.leaveAsIs' && s.tool.startsWith('line.')) assertLineStepResult(s.result);
  }
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

export const WORKFLOW_ACTION_KINDS = Object.freeze(['callService', 'setPartState', 'other']);

/**
 * Throw a TypeError naming the bad field unless `w` is a LineWorkflow: ids by kind, roles and transitions on its own
 * states, only a feature's own transitions removable, every When and Do a sentence.
 * @param {any} w The value to check.
 * @param {string} [where] Where it sits, for the error message.
 * @returns {void}
 */
export function assertLineWorkflow(w, where = 'workflow') {
  str(w?.id, `${where}.id`); str(w.name, `${where}.name`); str(w.file, `${where}.file`); str(w.machineId, `${where}.machineId`);
  if (!['library', 'feature'].includes(w.kind)) fail(`${where}.kind`, 'must be library or feature');
  if (w.kind === 'library' ? w.id !== `workflows/${w.name}` || w.feature !== null || w.base !== null : w.id !== `${w.feature}/workflows/${w.name}` || !w.base) {
    fail(`${where}.id`, 'a library workflow is "workflows/<name>" with no feature or base; a feature workflow is "<feature>/workflows/<name>" with a base');
  }
  const states = new Set();
  w.states.forEach((s, i) => { str(s.id, `${where}.states[${i}].id`); str(s.label, `${where}.states[${i}].label`); states.add(s.id); });
  if (w.initial !== null && !states.has(w.initial)) fail(`${where}.initial`, 'must name one of its states');
  w.roles.forEach((r, i) => {
    const v = `${where}.roles[${i}]`;
    if (!states.has(r.id)) fail(`${v}.id`, 'a role is one of its states');
    str(r.says, `${v}.says`);
    if (w.kind === 'library' && r.page !== null) fail(`${v}.page`, 'a library role has no page');
    if (typeof r.pageOk !== 'boolean') fail(`${v}.pageOk`, 'must be a boolean');
  });
  const ids = new Set();
  w.transitions.forEach((t, i) => {
    const v = `${where}.transitions[${i}]`;
    if (t.id !== `${t.from}|${t.event}`) fail(`${v}.id`, 'must be "<from>|<event>"');
    if (ids.has(t.id)) fail(`${v}.id`, 'must be unique');
    ids.add(t.id);
    if (!states.has(t.from) || (t.to !== null && !states.has(t.to))) fail(v, 'from and to must name its states');
    if (!['library', 'feature'].includes(t.origin)) fail(`${v}.origin`, 'must be library or feature');
    if (t.removable !== (t.origin === 'feature' && w.kind === 'feature')) fail(`${v}.removable`, 'only a feature\'s own transitions can be removed');
    t.actions.forEach((a, k) => { if (!WORKFLOW_ACTION_KINDS.includes(a?.kind)) fail(`${v}.actions[${k}].kind`, `must be one of ${WORKFLOW_ACTION_KINDS.join(', ')}`); });
    sentence(t.when, `${v}.when`); sentence(t.do, `${v}.do`);
  });
  if (!Array.isArray(w.summary) || !w.summary.length) fail(`${where}.summary`, 'must have at least one sentence');
  w.summary.forEach((x, i) => sentence(x, `${where}.summary[${i}]`));
  if (!Array.isArray(w.usedBy)) fail(`${where}.usedBy`, 'must be an array');
}

/**
 * Throw a TypeError naming the bad field unless `l` is a LineWorkflowList: the feature's own workflows, library ones,
 * the feature's pages and the files Cockpit cannot draw, each with a sentence.
 * @param {any} l The value to check.
 * @returns {asserts l is LineWorkflowList}
 */
export function assertLineWorkflowList(l) {
  str(l?.feature, 'workflows.feature');
  for (const k of ['workflows', 'library', 'pages', 'notMachines']) if (!Array.isArray(l[k])) fail(`workflows.${k}`, 'must be an array');
  l.workflows.forEach((w, i) => { assertLineWorkflow(w, `workflows.workflows[${i}]`); if (w.kind !== 'feature' || w.feature !== l.feature) fail(`workflows.workflows[${i}]`, 'must be a workflow of this feature'); });
  l.library.forEach((w, i) => { assertLineWorkflow(w, `workflows.library[${i}]`); if (w.kind !== 'library') fail(`workflows.library[${i}]`, 'must be a library workflow'); });
  l.notMachines.forEach((n, i) => { str(n.id, `workflows.notMachines[${i}].id`); str(n.file, `workflows.notMachines[${i}].file`); sentence(n.sentence, `workflows.notMachines[${i}].sentence`); });
}
