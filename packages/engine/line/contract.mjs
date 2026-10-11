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
  { method: 'GET', path: '/api/line/workspace', request: null, response: 'LineWorkspace' },
  { method: 'POST', path: '/api/line/workspace', request: 'WorkspaceRequest', response: 'LineWorkspace' },
  { method: 'POST', path: '/api/line/fix', request: 'FixRequest', response: 'ApplyResult' },
  { method: 'GET', path: '/api/line/fragments', request: 'file (query)', response: 'FragmentList' },
  { method: 'POST', path: '/api/line/fragment', request: 'SetFragmentRequest', response: 'ApplyResult' },
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

/** @param {any} f @param {string} where */
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

/** @param {any} p @returns {asserts p is LineProject} */
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

/** @param {any} c @returns {asserts c is StagedChange} */
export function assertStagedChange(c) {
  sentence(c?.summary, 'change.summary');
  if (!Array.isArray(c.files) || c.files.length === 0) fail('change.files', 'must list at least one file');
  for (const f of c.files) {
    str(f.path, 'change.files[].path');
    if (f.path.startsWith('/') || f.path.split('/').includes('..')) fail('change.files[].path', 'must be root-relative and stay inside the project');
    if (f.content !== null && typeof f.content !== 'string') fail('change.files[].content', 'must be a string or null');
  }
}

/** @param {any} r @returns {asserts r is ApplyResult} */
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
