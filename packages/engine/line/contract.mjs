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
 * @property {import('../../summarize/contract.mjs').Summary} [plain]  cs1: the step as the summarizer says it (packages/summarize).
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
  { name: 'line.import.mark', kind: 'write', request: '{folder, features, appFolders?}' },
  { name: 'line.import.toLibrary', kind: 'write', request: '{folder, from, kind, name, level?, keepShim?}' },
  { name: 'line.import.toFeature', kind: 'write', request: '{folder, mode, from?, kind, name, feature, base, keepShim?, route?}' },
  { name: 'line.amend', kind: 'write', request: '{change: {tool, args}, fix: {tool, args}} or {change, fixes: [{tool, args}, ...]}' },
  { name: 'line.baseWorkflowOn', kind: 'write', request: 'BaseWorkflowOnRequest' },
  { name: 'line.setWorkflowRole', kind: 'write', request: 'SetWorkflowRoleRequest' },
  { name: 'line.addWorkflowTransition', kind: 'write', request: 'AddWorkflowTransitionRequest' },
  { name: 'line.removeWorkflowTransition', kind: 'write', request: 'RemoveWorkflowTransitionRequest' },
  { name: 'line.leaveAsIs', kind: 'write', request: '{stepId}' },
  { name: 'line.import.fix', kind: 'write', request: '{folder, tool, args} (ci2: a typed fix run inside the import folder)' },
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
 * @property {string[]} [landed]  Folder files the steps before a refused one already wrote.
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
 * @property {string} [guidance]  Optional extra guidance for Qwen (ai-profiles.json; not shown in Settings).
 * @property {string} [question]  Optional wording of the pick question for jev (ai-profiles.json; not shown in Settings).
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

/**
 * cg1 -- Trace highlighting. ONE control registry: every Cockpit control that triggers a tool is registered with that
 * tool, and the DOM carries its id as `data-line-control` (and the item it acts on as `data-line-target`). cu3 adds an
 * optional `controlId` to each tool of the one tool registry (@mx/plan); this registry is the control side of that same
 * link (packages/engine/line/controls.mjs LINE_CONTROLS), never a second tool registry.
 *
 * @typedef {'components'|'pages'|'features'|'plan'} LineScreen  'plan' is the Plan panel, shown on Components and Pages.
 *
 * @typedef {object} LineControl
 * @property {string} controlId  Stable, "<screen>.<name>", e.g. "components.baseOn".
 * @property {string} toolId     The tool it triggers: a plan tool (LINE_PLAN_TOOLS) or a plan action (PLAN_ACTION_TOOLS).
 * @property {LineScreen} screen
 * @property {string} label      What the person sees on it, e.g. "Base on this".
 *
 * One scripted move of Auto (ct1): the simulated cursor goes to the control and does `kind`; `caption` says it in
 * plain English. `approve` is the Approve button: Auto stops there for the person unless they let Auto approve in
 * this session. The change itself always runs through the plan runner (the control's own handler adds the step).
 * @typedef {object} AutoAction
 * @property {'click'|'type'|'select'|'approve'} kind
 * @property {string} controlId
 * @property {string|null} target
 * @property {string} [value]    For type and select.
 * @property {string} caption    One sentence.
 *
 * A tool the request or a plan step needs, with the controls that do it.
 * @typedef {object} TraceTool
 * @property {string} toolId
 * @property {'request'|'step'} from
 * @property {string|null} stepId
 * @property {Record<string, unknown>} args   What static read from the request (may be partial).
 * @property {string} sentence   E.g. "Base a new component on Badge."
 * @property {{controlId: string, target: string|null, screen: LineScreen, label: string}[]} controls  In the order a person uses them (screen and label from the registry).
 * @property {AutoAction[]} script   Auto's moves for it (empty when Auto cannot fill it in).
 * @property {string|null} missing   What Auto still needs from the person, one sentence, or null.
 *
 * POST /api/line/trace {request?, steps?} answers this (a pure read: nothing is planned or written).
 * @typedef {{request?: string, steps?: {id: string, n?: number, tool: string, args?: Record<string, unknown>, state: string}[]}} TraceRequest
 * @typedef {object} TraceMatch
 * @property {true} ok
 * @property {string} request
 * @property {TraceTool[]} tools        The picked request tool first, then the open plan steps' tools.
 * @property {string[]} alternatives    Other tools the request could mean (not lit).
 * @property {{options: string[], picked: string, via: 'static'|'jev', sentence: string}|null} choice  Set when several tools fit the request.
 * @property {'static'|'jev'} via
 * @property {string} sentence          One sentence for the Trace bar.
 */

/** The Cockpit screens a control can sit on, and where each one is. */
export const LINE_SCREENS = Object.freeze([
  Object.freeze({ id: 'components', label: 'Components', href: '/components' }),
  Object.freeze({ id: 'pages', label: 'Pages', href: '/pages' }),
  Object.freeze({ id: 'features', label: 'Features', href: '/' }),
  Object.freeze({ id: 'plan', label: 'Plan panel', href: '/components' }),
]);
/** The plan actions a control can trigger besides the plan tools (a person's decisions on a step). */
export const PLAN_ACTION_TOOLS = Object.freeze([
  { name: 'plan.approve', kind: 'person', request: '{stepId}' },
  { name: 'plan.retry', kind: 'person', request: '{stepId}' },
]);
export const AUTO_ACTION_KINDS = Object.freeze(['click', 'type', 'select', 'approve']);

// ---------------------------------------------------------------------------------------------
// Import agent (ci2, packages/engine/line/importAgent.mjs): one agent in Import mode, run as a fixed typed process (an
// xstate machine): scan -> classify -> plan -> review -> execute -> verify -> done. Its whole state is ONE file inside the
// chosen folder, `<folder>/line/import-plan.json`, written only through Construct's writer (applyChange, folder as root),
// so it can be paused, resumed, edited by a person in Cockpit or by an agent over MCP, and every change is recorded.
// It decides through @mx/reason (packages/core/reason-provider.mjs; static order when reason is not linked), calls only
// registry tools, and executes ONLY by adding cp1 plan steps (line.import.*): a person still approves every write.

/**
 * One step of the import plan file (an ImportStep plus its review and run state).
 * @typedef {object} ImportAgentStep
 * @property {string} id
 * @property {'line.import.mark'|'line.import.toLibrary'|'line.import.toFeature'} tool
 * @property {Record<string, unknown>} args     Always includes `folder`; only the IMPORT_EDITABLE fields may change.
 * @property {string} sentence
 * @property {'proposed'|'approved'|'skipped'} review
 * @property {'todo'|'running'|'done'|'needs-you'|'left'} run   left: the person chose to leave it as it is.
 * @property {string[]} planStepIds   The cp1 plan steps it ran as (the step, its fixes, its retries), in order.
 * @property {number} rounds          Fix rounds so far (each must pass more checks than the one before).
 * @property {string|null} outcome    One sentence once it ran.
 *
 * One recorded change to the plan or the process (who, what, when).
 * @typedef {{n: number, at: string, by: 'ui'|'agent'|'line', action: 'start'|'state'|'decide'|'edit'|'skip'|'unskip'|'move'|'approve'|'approve-all'|'add-step'|'answer'|'pause'|'resume'|'verify', stepId?: string, sentence: string}} ImportChange
 *
 * One decision the agent took (a classify question or a fix to try), and who took it.
 * @typedef {{id: string, question: string, options: string[], picked: string, answer: string, by: 'static'|'single'|'order'|'jev'|'person', reason: string}} ImportDecision
 *
 * What the process waits for. `approval`: a person approves cp1 plan step `planStepId` (Plan panel or Import agent).
 * `review`: the plan steps are approved (a person, or the person's coding agent over MCP). `answer`: one question.
 * @typedef {{for: 'review'|'approval'|'answer', sentence: string, stepId?: string, planStepId?: string,
 *   question?: {id: string, sentence: string, options: {id: string, sentence: string}[], recommended: string}}} ImportWaiting
 *
 * The verify stage: validate --profile line on the folder, types (tsc), tests. A check Line cannot run says why (skipped).
 * @typedef {{id: 'validate'|'types'|'tests', state: 'pass'|'fail'|'skipped', sentence: string, detail?: string}} ImportVerifyCheck
 *
 * `<folder>/line/import-plan.json`.
 * @typedef {object} ImportPlanFile
 * @property {1} version
 * @property {string} folder
 * @property {'scan'|'classify'|'plan'|'review'|'execute'|'verify'|'done'} state
 * @property {boolean} paused
 * @property {ImportWaiting|null} waiting
 * @property {{file: string, name: string, kind: LineKind, target: 'library'|'feature', feature?: string}[]} found
 * @property {Record<string, string>} answers     Classify question id -> option id.
 * @property {ImportDecision[]} decisions
 * @property {ImportAgentStep[]} steps
 * @property {{pending: string|null, origin: string|null, phase: 'step'|'fix'|'retry'|'leave'|'refresh'|null}} cursor  The cp1 step being waited on.
 * @property {{ok: boolean, checks: ImportVerifyCheck[]}|null} verify
 * @property {ImportChange[]} changes
 *
 * GET /api/line/import-agent?folder= and every import-agent write answer this.
 * @typedef {object} ImportAgentView
 * @property {true} ok
 * @property {string} folder
 * @property {'idle'|'scan'|'classify'|'plan'|'review'|'execute'|'verify'|'done'} state  idle: no import-plan.json yet.
 * @property {boolean} paused
 * @property {ImportWaiting|null} waiting
 * @property {{id: string, label: string, status: 'done'|'current'|'todo'}[]} stages
 * @property {string} sentence   Where the process is, in plain English.
 * @property {ImportAgentStep[]} steps
 * @property {ImportDecision[]} decisions
 * @property {ImportChange[]} changes
 * @property {{ok: boolean, checks: ImportVerifyCheck[]}|null} verify
 * @property {string} decider   One sentence: who decides (reason linked, or the static order).
 *
 * POST /api/line/import-agent/step: change one plan step (before it runs). `to` is the new 0-based index for `move`.
 * @typedef {{folder: string, stepId?: string, action: 'edit'|'skip'|'unskip'|'move'|'approve'|'approve-all', args?: Record<string, unknown>, to?: number}} ImportStepEdit
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
 * cu3 -- ONE tool registry (packages/engine/line/toolRegistry.mjs). Every capability is one typed tool call that the
 * Cockpit's /api/line routes, construct-mcp, GateLM (through @mx/plan, packages/line-links) and Studio's dispatcher all
 * resolve from. Reads dispatch directly. A write to project files only ever becomes a plan step (it runs after a
 * person's approval, per step, or Auto's); a write to Line's own state (line/: the plan, the workspace) is written
 * atomically and logged (line/log/tools.jsonl) without asking. Agents stay read-only unless a write is approved.
 *
 * @typedef {'read'|'write'} ToolKind
 * @typedef {'project'|'line'} ToolWrites  What a write changes: project files, or Line's own state.
 * @typedef {{safeParse: (v: unknown) => ({success: true, data: any} | {success: false, error: {issues: {path: (string|number)[], message: string}[]}}), fields?: string[]}} ToolInputSchema
 *
 * @typedef {object} ToolSurfaces  Where the tool can be called from (each maps to exactly one registry entry).
 * @property {{method: 'GET'|'POST', path: string}} [http]   A Cockpit /api/line route.
 * @property {string} [mcp]        A construct-mcp tool name.
 * @property {boolean} [plan]      A plan step can run it (the tool is in the plan runner's registry).
 * @property {boolean} [gatelm]    One of GateLM's tools (@mx/plan gatelmTools).
 * @property {boolean} [studio]    Studio's dispatcher runs it (a GateLM question's option carries it).
 *
 * @typedef {object} ToolEntry
 * @property {string} id               e.g. `line.baseOn`, `plan.status`, `blocks.validate`, `gatelm.fill`, `construct.validate`.
 * @property {ToolKind} kind
 * @property {ToolWrites|null} writes  Null for a read.
 * @property {ToolInputSchema} inputSchema
 * @property {string} outputSchema     The contract shape it answers (a typedef name here or in the linked package).
 * @property {string} sentence         Plain English: what the tool does, one sentence.
 * @property {string} [controlId]      The Cockpit control that does the same (cg1/ct1 light it up); optional.
 * @property {boolean} [personOnly]    Only a person may call it (plan.approve): an agent is refused.
 * @property {ToolSurfaces} surfaces
 *
 * GET /api/line/tools: the registry as Cockpit and agents read it (no schemas, the input's field names instead).
 * @typedef {{id: string, kind: ToolKind, writes: ToolWrites|null, sentence: string, outputSchema: string,
 *   inputFields: string[], controlId?: string, personOnly?: boolean, surfaces: ToolSurfaces}} ToolView
 * @typedef {{ok: true, tools: ToolView[]}} ToolList
 *
 * What dispatching a call answers: a read's (or a Line-state write's) result, or the plan step a project write became.
 * @typedef {{ok: true, via: 'direct', id: string, result: unknown}
 *   | {ok: true, via: 'plan', id: string, stepId: string, sentence: string, plan: PlanView}
 *   | {ok: false, id: string, code: string, sentence: string, detail?: string}} DispatchResult
 */
export const TOOL_KINDS = Object.freeze(['read', 'write']);
export const TOOL_WRITES = Object.freeze(['project', 'line']);
export const TOOL_ID = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/;

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
  { method: 'GET', path: '/api/line/workflows', request: 'feature (query)', response: 'LineWorkflowList' },
  { method: 'POST', path: '/api/line/plan/step', request: 'PlanStepRequest', response: 'PlanView & {stepId}' },
  { method: 'POST', path: '/api/line/plan/approve', request: '{stepId} | {stepIds}', response: 'PlanView' },
  { method: 'POST', path: '/api/line/plan/run', request: '{stepId?}', response: 'PlanView' },
  { method: 'GET', path: '/api/line/import/folders', request: null, response: '{sourceRoot, folders: {path, files}[]}' },
  { method: 'POST', path: '/api/line/import/scan', request: 'ImportScanRequest', response: 'ImportScan' },
  { method: 'POST', path: '/api/line/import/plan', request: 'ImportPlanRequest', response: 'ImportPlan' },
  { method: 'POST', path: '/api/line/new-project', request: 'NewLineProjectRequest', response: 'NewLineProjectResult' },
  { method: 'GET', path: '/api/line/tools', request: null, response: 'ToolList' },
  { method: 'GET', path: '/api/line/ai-profiles', request: null, response: 'AiProfiles' },
  { method: 'POST', path: '/api/line/trace', request: 'TraceRequest', response: 'TraceMatch' },
  { method: 'GET', path: '/api/line/import-agent', request: 'folder (query)', response: 'ImportAgentView' },
  { method: 'POST', path: '/api/line/import-agent/start', request: '{folder}', response: 'ImportAgentView' },
  { method: 'POST', path: '/api/line/import-agent/resume', request: '{folder}', response: 'ImportAgentView' },
  { method: 'POST', path: '/api/line/import-agent/pause', request: '{folder}', response: 'ImportAgentView' },
  { method: 'POST', path: '/api/line/import-agent/step', request: 'ImportStepEdit', response: 'ImportAgentView' },
  { method: 'POST', path: '/api/line/import-agent/answer', request: '{folder, questionId, optionId}', response: 'ImportAgentView' },
]);

/** The tools an import plan's steps name (plan-ready: each produces a StagedChange for applyChange). */
export const IMPORT_TOOLS = Object.freeze(['line.import.mark', 'line.import.toLibrary', 'line.import.toFeature']);

export const LINE_FIX_TOOLS = Object.freeze(['line.setBase', 'line.promote', 'line.baseOn', 'line.moveFile', 'line.createLayout', 'line.amend']);

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
 * Throws unless e is a ToolEntry (dotted id, kind, what it writes, input schema, surfaces that fit its kind).
 * @param {any} e
 * @returns {asserts e is ToolEntry}
 */
export function assertToolEntry(e) {
  const w = `tool ${e?.id ?? '?'}`;
  if (typeof e?.id !== 'string' || !TOOL_ID.test(e.id)) fail(`${w}.id`, 'must be a dotted name like line.baseOn');
  if (!TOOL_KINDS.includes(e.kind)) fail(`${w}.kind`, 'must be read or write');
  if (e.kind === 'read' && e.writes !== null) fail(`${w}.writes`, 'a read writes nothing (null)');
  if (e.kind === 'write' && !TOOL_WRITES.includes(e.writes)) fail(`${w}.writes`, 'a write says what it changes: project or line');
  if (typeof e.inputSchema?.safeParse !== 'function') fail(`${w}.inputSchema`, 'must have safeParse');
  str(e.outputSchema, `${w}.outputSchema`);
  sentence(e.sentence, `${w}.sentence`);
  if (e.controlId !== undefined) str(e.controlId, `${w}.controlId`);
  if (!e.surfaces || typeof e.surfaces !== 'object') fail(`${w}.surfaces`, 'must be an object');
  const h = e.surfaces.http;
  if (h !== undefined && (!['GET', 'POST'].includes(h.method) || typeof h.path !== 'string' || !h.path.startsWith('/api/line/'))) fail(`${w}.surfaces.http`, 'must be {method, path} under /api/line/');
  if (h?.method === 'GET' && e.kind !== 'read') fail(`${w}.surfaces.http`, 'a GET route only reads');
  if (e.personOnly && e.surfaces.mcp) fail(`${w}.surfaces.mcp`, 'a person-only tool is never an agent tool');
  if (e.kind === 'write' && e.writes === 'project' && e.surfaces.mcp) fail(`${w}.surfaces.mcp`, 'an agent never writes project files directly; it adds a plan step');
}

/**
 * Throws unless l is a ToolList (GET /api/line/tools: unique ids, each a ToolView).
 * @param {any} l
 * @returns {asserts l is ToolList}
 */
export function assertToolList(l) {
  if (l?.ok !== true || !Array.isArray(l.tools)) fail('tools', 'must be {ok: true, tools: [...]}');
  const ids = new Set();
  for (const t of l.tools) {
    if (ids.has(t.id)) fail(`tool ${t.id}`, 'ids are unique');
    ids.add(t.id);
    if (!TOOL_KINDS.includes(t.kind)) fail(`tool ${t.id}.kind`, 'must be read or write');
    sentence(t.sentence, `tool ${t.id}.sentence`);
    if (!Array.isArray(t.inputFields)) fail(`tool ${t.id}.inputFields`, 'must be an array');
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

// cu2 ------------------------------------------------------------------------------------------
const rate = (v, where) => (typeof v === 'number' && v >= 0 && v <= 1) || fail(where, 'must be a number from 0 to 1');
const STEP_ID = /^[a-z]+\.[A-Za-z][\w-]*$/;

/**
 * cu2: throws unless p is a StepProfile.
 * @param {any} p
 * @param {string} [where]
 * @returns {asserts p is StepProfile}
 */
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

/**
 * cu2: throws unless r is a DecideResult (its choice one of the offered ids, when known).
 * @param {any} r
 * @param {string[]} [optionIds] The ids that were offered, when known.
 * @returns {asserts r is DecideResult}
 */
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

/**
 * cu2: throws unless x is a DecideLoopResult.
 * @param {any} x
 * @returns {asserts x is DecideLoopResult}
 */
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

/**
 * cu2: throws unless x is AiProfiles (GET /api/line/ai-profiles).
 * @param {any} x
 * @returns {asserts x is AiProfiles}
 */
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
const SCREEN_IDS = ['components', 'pages', 'features', 'plan'];
const TOOL_IDS = () => [...LINE_PLAN_TOOLS, ...PLAN_ACTION_TOOLS].map((t) => t.name);

/**
 * cg1: throws unless c is a LineControl ("<screen>.<name>" id on its screen, a known tool, a label not a sentence).
 * @param {any} c
 * @param {string} [where]
 * @returns {asserts c is LineControl}
 */
export function assertLineControl(c, where = 'control') {
  str(c?.controlId, `${where}.controlId`);
  if (!/^[a-z]+\.[A-Za-z]+$/.test(c.controlId)) fail(`${where}.controlId`, 'must be "<screen>.<name>"');
  if (!SCREEN_IDS.includes(c.screen)) fail(`${where}.screen`, `must be one of ${SCREEN_IDS.join(', ')}`);
  if (c.controlId.split('.')[0] !== c.screen) fail(`${where}.controlId`, 'must start with its screen');
  if (!TOOL_IDS().includes(c.toolId)) fail(`${where}.toolId`, `must be a plan tool or plan action, not ${c.toolId}`);
  str(c.label, `${where}.label`);
  if (/[.?!]$/.test(c.label)) fail(`${where}.label`, 'is a label, not a sentence');
}

/**
 * cg1: throws unless list is the control registry (non-empty, every control valid, ids unique).
 * @param {any} list
 * @returns {asserts list is LineControl[]}
 */
export function assertControlRegistry(list) {
  if (!Array.isArray(list) || !list.length) fail('controls', 'must be a non-empty array');
  const ids = new Set();
  list.forEach((c, i) => {
    assertLineControl(c, `controls[${i}]`);
    if (ids.has(c.controlId)) fail(`controls[${i}].controlId`, 'must be unique: one registry, one entry per control');
    ids.add(c.controlId);
  });
}

/**
 * ct1: throws unless a is one of Auto's moves (kind, control, target, value for type and select, a caption).
 * @param {any} a
 * @param {string} [where]
 * @returns {asserts a is AutoAction}
 */
export function assertAutoAction(a, where = 'action') {
  if (!AUTO_ACTION_KINDS.includes(a?.kind)) fail(`${where}.kind`, `must be one of ${AUTO_ACTION_KINDS.join(', ')}`);
  str(a.controlId, `${where}.controlId`);
  if (a.target !== null && typeof a.target !== 'string') fail(`${where}.target`, 'must be a string or null');
  if ((a.kind === 'type' || a.kind === 'select') && typeof a.value !== 'string') fail(`${where}.value`, 'type and select carry a value');
  sentence(a.caption, `${where}.caption`);
}

/**
 * cg1: throws unless m is a TraceMatch (POST /api/line/trace).
 * @param {any} m
 * @returns {asserts m is TraceMatch}
 */
export function assertTraceMatch(m) {
  if (m?.ok !== true) fail('trace.ok', 'must be true');
  if (typeof m.request !== 'string') fail('trace.request', 'must be a string');
  if (!['static', 'jev'].includes(m.via)) fail('trace.via', 'must be static or jev');
  sentence(m.sentence, 'trace.sentence');
  if (!Array.isArray(m.tools) || !Array.isArray(m.alternatives)) fail('trace.tools', 'tools and alternatives must be arrays');
  m.tools.forEach((t, i) => {
    const w = `trace.tools[${i}]`;
    if (!TOOL_IDS().includes(t.toolId)) fail(`${w}.toolId`, 'unknown tool');
    if (!['request', 'step'].includes(t.from)) fail(`${w}.from`, 'must be request or step');
    if ((t.from === 'step') !== (typeof t.stepId === 'string')) fail(`${w}.stepId`, 'a step tool names its step, a request tool does not');
    sentence(t.sentence, `${w}.sentence`);
    if (!Array.isArray(t.controls)) fail(`${w}.controls`, 'must be an array');
    t.controls.forEach((c, j) => { str(c.controlId, `${w}.controls[${j}].controlId`); if (!SCREEN_IDS.includes(c.screen)) fail(`${w}.controls[${j}].screen`, 'unknown screen'); str(c.label, `${w}.controls[${j}].label`); });
    if (!Array.isArray(t.script)) fail(`${w}.script`, 'must be an array');
    t.script.forEach((a, j) => assertAutoAction(a, `${w}.script[${j}]`));
    if (t.missing !== null) sentence(t.missing, `${w}.missing`);
  });
  if (m.choice !== null) {
    if (!Array.isArray(m.choice?.options) || m.choice.options.length < 2) fail('trace.choice.options', 'a choice has at least two options');
    if (!m.choice.options.includes(m.choice.picked)) fail('trace.choice.picked', 'must be one of the options');
    if (!['static', 'jev'].includes(m.choice.via)) fail('trace.choice.via', 'must be static or jev');
    if (m.choice.via !== m.via) fail('trace.via', 'must equal the choice\'s via');
    sentence(m.choice.sentence, 'trace.choice.sentence');
  }
}

// --------------------------------------------------------------------------------------------- ci2 import agent
export const IMPORT_AGENT_STATES = Object.freeze(['scan', 'classify', 'plan', 'review', 'execute', 'verify', 'done']);
export const IMPORT_AGENT_STAGES = Object.freeze([
  { id: 'scan', label: 'Read the folder' }, { id: 'classify', label: 'Sort the items' }, { id: 'plan', label: 'Write the plan' },
  { id: 'review', label: 'Review' }, { id: 'execute', label: 'Make the changes' }, { id: 'verify', label: 'Check everything' }, { id: 'done', label: 'Done' },
]);
/** The args a person or agent may change on an import plan step, per tool (everything else is fixed by the scan). */
export const IMPORT_EDITABLE = Object.freeze({
  'line.import.mark': Object.freeze(['features']),
  'line.import.toLibrary': Object.freeze(['name', 'level', 'keepShim']),
  'line.import.toFeature': Object.freeze(['name', 'feature', 'base']),
});
export const IMPORT_PLAN_FILE = 'line/import-plan.json';
/**
 * Why `folder` is not a folder inside the project (relative, no "." or ".." parts), or null.
 * @param {any} folder
 * @returns {any}
 */
export function importFolderProblem(folder) {
  if (typeof folder !== 'string' || !folder) return 'must name the import folder';
  if (folder.startsWith('/') || folder.includes('\\') || folder.split('/').some((p) => p === '..' || p === '.' || p === '')) return 'must be a folder inside the project, like src/alerts';
  return null;
}
const CHANGE_ACTIONS = ['start', 'state', 'decide', 'edit', 'skip', 'unskip', 'move', 'approve', 'approve-all', 'add-step', 'answer', 'pause', 'resume', 'verify'];

/** @param {any} w @param {string} where */
function assertWaiting(w, where) {
  if (w === null) return;
  if (!['review', 'approval', 'answer'].includes(w?.for)) fail(`${where}.for`, 'must be review, approval or answer');
  sentence(w.sentence, `${where}.sentence`);
  if (w.for === 'approval') str(w.planStepId, `${where}.planStepId`);
  if (w.for === 'answer') {
    const q = w.question;
    str(q?.id, `${where}.question.id`);
    sentence(q.sentence, `${where}.question.sentence`);
    if (!Array.isArray(q.options) || q.options.length < 1) fail(`${where}.question.options`, 'must offer at least one option');
    q.options.forEach((o, i) => { str(o.id, `${where}.question.options[${i}].id`); sentence(o.sentence, `${where}.question.options[${i}].sentence`); });
    if (!q.options.some((o) => o.id === q.recommended)) fail(`${where}.question.recommended`, 'must be one of the options');
  }
}

/** @param {any} s @param {string} folder @param {string} where */
function assertAgentStep(s, folder, where) {
  str(s?.id, `${where}.id`);
  if (!IMPORT_TOOLS.includes(s.tool)) fail(`${where}.tool`, `must be one of ${IMPORT_TOOLS.join(', ')}`);
  if (s.args?.folder !== folder) fail(`${where}.args.folder`, 'must name the plan\'s folder');
  sentence(s.sentence, `${where}.sentence`);
  if (!['proposed', 'approved', 'skipped'].includes(s.review)) fail(`${where}.review`, 'must be proposed, approved or skipped');
  if (!['todo', 'running', 'done', 'needs-you', 'left'].includes(s.run)) fail(`${where}.run`, 'unknown run state');
  if (!Array.isArray(s.planStepIds)) fail(`${where}.planStepIds`, 'must be an array');
  if (!Number.isInteger(s.rounds) || s.rounds < 0) fail(`${where}.rounds`, 'must be a whole number');
  if (s.outcome !== null) sentence(s.outcome, `${where}.outcome`);
}

/** @param {any} c @param {string} where */
function assertChange(c, where) {
  if (!Number.isInteger(c?.n) || c.n < 1) fail(`${where}.n`, 'must count from 1');
  str(c.at, `${where}.at`);
  if (!['ui', 'agent', 'line'].includes(c.by)) fail(`${where}.by`, 'must be ui, agent or line');
  if (!CHANGE_ACTIONS.includes(c.action)) fail(`${where}.action`, 'unknown action');
  sentence(c.sentence, `${where}.sentence`);
}

/** @param {any} v @param {string} where */
function assertVerify(v, where) {
  if (v === null) return;
  if (typeof v?.ok !== 'boolean' || !Array.isArray(v.checks)) fail(where, 'must be {ok, checks}');
  v.checks.forEach((c, i) => {
    if (!['validate', 'types', 'tests'].includes(c.id)) fail(`${where}.checks[${i}].id`, 'must be validate, types or tests');
    if (!['pass', 'fail', 'skipped'].includes(c.state)) fail(`${where}.checks[${i}].state`, 'must be pass, fail or skipped');
    sentence(c.sentence, `${where}.checks[${i}].sentence`);
  });
  if (v.ok && v.checks.some((c) => c.state === 'fail')) fail(where, 'ok only when no check fails');
}

/**
 * Throws unless p is a ImportPlanFile.
 * @param {any} p
 * @returns {asserts p is ImportPlanFile}
 */
export function assertImportPlanFile(p) {
  if (p?.version !== 1) fail('importPlan.version', 'must be 1');
  relPath(p.folder, 'importPlan.folder');
  if (!IMPORT_AGENT_STATES.includes(p.state)) fail('importPlan.state', `must be one of ${IMPORT_AGENT_STATES.join(', ')}`);
  if (typeof p.paused !== 'boolean') fail('importPlan.paused', 'must be true or false');
  assertWaiting(p.waiting, 'importPlan.waiting');
  if (!Array.isArray(p.found) || !Array.isArray(p.decisions) || !Array.isArray(p.steps) || !Array.isArray(p.changes)) fail('importPlan', 'found, decisions, steps and changes must be arrays');
  if (!p.answers || typeof p.answers !== 'object') fail('importPlan.answers', 'must be an object');
  const ids = new Set();
  p.steps.forEach((s, i) => { assertAgentStep(s, p.folder, `importPlan.steps[${i}]`); if (ids.has(s.id)) fail(`importPlan.steps[${i}].id`, 'must be unique'); ids.add(s.id); });
  p.decisions.forEach((d, i) => {
    str(d.id, `importPlan.decisions[${i}].id`);
    if (!d.options.includes(d.picked)) fail(`importPlan.decisions[${i}].picked`, 'must be one of its options');
    if (!['static', 'single', 'order', 'jev', 'person'].includes(d.by)) fail(`importPlan.decisions[${i}].by`, 'unknown decider');
    sentence(d.reason, `importPlan.decisions[${i}].reason`);
    sentence(d.answer, `importPlan.decisions[${i}].answer`);
  });
  p.changes.forEach((c, i) => { assertChange(c, `importPlan.changes[${i}]`); if (c.n !== i + 1) fail(`importPlan.changes[${i}].n`, 'must count up by one'); });
  if (!p.cursor || !['step', 'fix', 'retry', 'leave', 'refresh', null].includes(p.cursor.phase)) fail('importPlan.cursor', 'must be {pending, origin, phase}');
  assertVerify(p.verify, 'importPlan.verify');
  if (p.state === 'done' && p.steps.some((s) => s.review !== 'skipped' && !['done', 'left'].includes(s.run))) fail('importPlan.state', 'done only when every step ran or was left');
}

/**
 * Throws unless v is a ImportAgentView.
 * @param {any} v
 * @returns {asserts v is ImportAgentView}
 */
export function assertImportAgentView(v) {
  if (v?.ok !== true) fail('agent.ok', 'must be true');
  str(v.folder, 'agent.folder');
  if (v.state !== 'idle' && !IMPORT_AGENT_STATES.includes(v.state)) fail('agent.state', 'unknown state');
  if (typeof v.paused !== 'boolean') fail('agent.paused', 'must be true or false');
  assertWaiting(v.waiting, 'agent.waiting');
  if (!Array.isArray(v.stages) || v.stages.length !== IMPORT_AGENT_STAGES.length) fail('agent.stages', 'must list every stage');
  if (v.stages.filter((s) => s.status === 'current').length > 1) fail('agent.stages', 'at most one stage is current');
  sentence(v.sentence, 'agent.sentence');
  sentence(v.decider, 'agent.decider');
  v.steps.forEach((s, i) => assertAgentStep(s, v.folder, `agent.steps[${i}]`));
  v.changes.forEach((c, i) => assertChange(c, `agent.changes[${i}]`));
  assertVerify(v.verify, 'agent.verify');
}
