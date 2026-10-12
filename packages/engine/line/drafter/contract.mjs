// System 1 drafter contract (owner 2026-10-11): for every request, Line's own structured form, never code or files.
//
//   request + facts summary
//     -> delexicalize   names from the project become typed slots ("update <feature:F1> flow"); domain words never stored
//     -> classify       closed labels only: intent id from INTENT_CATALOG (verb x structural object), target slot,
//                       candidate layers with confidence; static rules now, a small trained classifier later (same shape)
//     -> enumerate      every sensible route (layer combination x scope) from the tool templates, each with plan steps
//                       (registry tool calls with slot-form args), expected-output expressions, a structural delta and
//                       its predicted structure hashes
//     -> verify         Construct applies each route in a scratch copy (applyChange), evaluates the expressions and
//                       hashes the result; refused routes carry Construct's sentence and typed fix; a hash mismatch is
//                       a miss
//     -> rank           static order now; jev only ranks (a `ranker` hook); the person picks
//
// The drafter only drafts. Line's writer and checks decide what lands, and a person approves every write step.
// Stored records hold slots, kinds, roles, layers, tools, expressions, deltas and hashes: never a project's names.
import { exprProblem } from '../contract.mjs';
import { projectWordIn } from '../slots.mjs';

/** Verbs of the intent catalog (owner list, plus fix for a finding's typed fix). */
export const VERBS = Object.freeze(['add', 'update', 'remove', 'rename', 'move', 'promote', 'base-on', 'wire', 'split', 'merge', 'fix']);

/**
 * Structural objects of the intent catalog and the layers each lives in. Layers: ui (pages, components), workflow,
 * data (fixtures), api (services; Line has no such layer yet, so api routes are dropped with a sentence), library.
 */
export const OBJECTS = Object.freeze({
  variable: ['ui', 'workflow'],
  prop: ['ui'],
  handler: ['ui'],
  page: ['ui'],
  component: ['ui'],
  'feature-flow': ['ui', 'workflow', 'api', 'library'],
  workflow: ['workflow'],
  'workflow-step': ['workflow'],
  service: ['api'],
  'data-shape': ['data', 'api'],
  route: ['ui'],
  fixture: ['data'],
  test: ['ui', 'workflow'],
  feature: ['ui', 'workflow', 'data'],
  'library-item': ['library'],
  layout: ['library'],
  problem: ['ui', 'workflow', 'data', 'library'],
});
export const LAYERS = Object.freeze(['ui', 'workflow', 'data', 'api', 'library']);
/** Line kinds per layer (the library layer holds every kind; api has none yet). */
export const LAYER_KINDS = Object.freeze({ ui: ['pages', 'components'], workflow: ['workflows'], data: ['fixtures'], api: [], library: ['components', 'pages', 'workflows', 'fixtures'] });
export { KIND_LAYER } from '../structure.mjs';
export const SCOPES = Object.freeze(['feature', 'library', 'cross-feature']);
export const VIA = Object.freeze(['template', 'retrieval', 'model']);
export const ROUTE_STATUS = Object.freeze(['ok', 'refused', 'wrong-shape', 'failed', 'needs-model', 'unverified']);

/** Slot kinds: what a typed slot in a delexicalized request or a slot-form arg stands for. */
export const SLOT_KINDS = Object.freeze({
  F: 'feature', P: 'page', C: 'component', W: 'workflow', X: 'fixture', L: 'library', A: 'prop', S: 'variable', V: 'value', N: 'new', K: 'code', R: 'problem', T: 'part', G: 'fragment', U: 'unknown',
  M: 'missing',
});
/** A slot reference inside a stored string: <F1>, <C1.file>, or as written in a request <feature:F1>. */
export const SLOT_REF = /<([A-Z])(\d+)(?:\.([a-zA-Z][a-zA-Z0-9]*))?>/g;
export const REQUEST_SLOT = /<([a-z-]+):([A-Z]\d+)>/g;

/**
 * Tool templates: what each can satisfy (intent ids) and which registry tools it calls. The catalog below is generated
 * from these plus the registry, so a template whose tool is missing never appears.
 */
export const TEMPLATES = Object.freeze({
  'base-on': { tools: ['line.baseOn'], intents: ['add.component', 'add.page', 'add.workflow', 'add.fixture', 'base-on.component', 'base-on.page', 'base-on.workflow', 'base-on.fixture', 'base-on.library-item', 'add.feature-flow'] },
  'via-library': { tools: ['line.promote', 'line.baseOn'], intents: ['add.component', 'add.page', 'add.workflow', 'add.fixture', 'base-on.component', 'base-on.page', 'wire.component'] },
  promote: { tools: ['line.promote'], intents: ['promote.component', 'promote.page', 'promote.workflow', 'promote.fixture', 'move.library-item', 'move.component', 'move.page'] },
  'set-base': { tools: ['line.setBase'], intents: ['base-on.component', 'base-on.page', 'base-on.workflow', 'base-on.fixture', 'wire.component'] },
  'set-prop': { tools: ['line.setPageProp'], intents: ['update.prop', 'update.page', 'update.component', 'update.feature-flow', 'rename.prop'] },
  'set-fragment': { tools: ['line.setFragment'], intents: ['update.handler', 'update.variable', 'update.workflow-step', 'update.workflow', 'update.feature-flow', 'update.prop', 'wire.handler'] },
  fix: { tools: ['line.fix'], intents: ['fix.problem'] },
  'fix-all': { tools: ['line.fix'], intents: ['fix.problem'] },
  /** im1: a typed fix's own plan step taken directly (move the cross-feature item into the library). */
  'fix-step': { tools: ['line.promote'], intents: ['fix.problem'] },
  'create-layout': { tools: ['line.createLayout'], intents: ['add.layout'] },
  'new-feature': { tools: ['line.baseOn'], intents: ['add.feature'] },
  /** Two single-layer routes on different layers, run one after the other (multi-layer intents only). */
  combo: { tools: [], intents: [] },
});

/**
 * One entry of the intent catalog.
 * @typedef {object} IntentEntry
 * @property {string} id         Stable, e.g. "update.feature-flow".
 * @property {string} verb
 * @property {string} object
 * @property {string[]} layers   Where the object lives.
 * @property {string[]} templates  The templates that can satisfy it ([] = known operation, no static route yet: Qwen or ask).
 * @property {string[]} tools
 */

/**
 * The intent catalog: every verb x structural object, with the templates (and so the registry tools) that satisfy
 * it. Generated, never hand-listed.
 * @param {string[]} toolNames The registry's tool names (registry.list().map((t) => t.name)).
 * @returns {IntentEntry[]}
 */
export function buildIntentCatalog(toolNames) {
  const have = new Set(toolNames);
  const usable = Object.entries(TEMPLATES).filter(([, t]) => t.tools.every((x) => have.has(x)));
  const out = [];
  for (const verb of VERBS) {
    for (const [object, layers] of Object.entries(OBJECTS)) {
      const id = `${verb}.${object}`;
      const templates = usable.filter(([, t]) => t.intents.includes(id)).map(([name]) => name);
      const tools = [...new Set(templates.flatMap((n) => TEMPLATES[n].tools))];
      out.push({ id, verb, object, layers: [...layers], templates, tools });
    }
  }
  return out;
}

/** How each verb of the catalog reads at the start of a phrase. */
const VERB_PHRASE = Object.freeze({ add: 'Add', update: 'Change', remove: 'Remove', rename: 'Rename', move: 'Move', promote: 'Move into the library', 'base-on': 'Base on the library', wire: 'Wire up', split: 'Split', merge: 'Merge', fix: 'Fix' });
/** How each structural object of the catalog reads. */
const OBJECT_PHRASE = Object.freeze({
  variable: 'a variable', prop: 'a value on a page', handler: 'what a page does on an action', page: 'a page', component: 'a component',
  'feature-flow': 'a feature\'s flow', workflow: 'a flow', 'workflow-step': 'a step of a flow', service: 'a service', 'data-shape': 'a data shape',
  route: 'a route', fixture: 'sample data', test: 'a test', feature: 'a feature', 'library-item': 'a library item', layout: 'the layout', problem: 'a reported problem',
});

/**
 * An intent id as a plain phrase: "add.component" -> "Add a component", "promote.component" -> "Move a component into
 * the library". Unknown ids come back as they are.
 * @param {string} id
 * @returns {string}
 */
export function intentPhrase(id) {
  const [verb, object] = String(id).split('.');
  if (!VERB_PHRASE[verb] || !OBJECT_PHRASE[object]) return String(id);
  if (verb === 'promote') return `Move ${OBJECT_PHRASE[object]} into the library`;
  if (verb === 'base-on') return `Base ${OBJECT_PHRASE[object]} on the library`;
  return `${VERB_PHRASE[verb]} ${OBJECT_PHRASE[object]}`;
}

// ------------------------------------------------------------------------------------------------ gold routes
/** What a stored (gold) route says Line should do. */
export const GOLD_OUTCOMES = Object.freeze(['change', 'refusal', 'question']);

/**
 * A route as a training case stores it (Train Line's gold; the drafter's Route reduced to what a person judges):
 * slotted, never a project name. `outcome` says what Line should do: make the change, refuse it, or ask first.
 * @typedef {object} GoldRoute
 * @property {string} id
 * @property {string} label      Plain English, slotted: "Inside <feature:F1> only".
 * @property {{layers: string[], features: string[], library: boolean}} scope  What it touches (layers as Line kinds, features as slot names).
 * @property {{tool: string, args: Record<string, unknown>}[]} steps  Slotted args ("<feature:F1>", whole or inside a string).
 * @property {object[]} expect   Expressions of Line's one language (../contract.mjs LineExpr, its named checks), slotted.
 * @property {number} cost       Number of steps.
 * @property {'low'|'medium'|'high'} risk  low: one feature; medium: the library (every feature that uses it).
 * @property {'change'|'refusal'|'question'} outcome
 * @property {{code?: string, rule?: string, fixes?: boolean}} [refusal]  A refusal route: what Construct must say.
 * @property {{about: string, sentence: string, tool?: string, args?: Record<string, unknown>}} [question]  A question route: what Line must ask (slotted sentence).
 */

const GOLD_SLOT = /<([a-z]+):([A-Z][A-Za-z]*\d+)>/g;

/**
 * Throws unless r is a GoldRoute whose tools are in `tools` and whose every slot is declared in `slots`.
 * @param {any} r @param {Record<string, any>} slots @param {readonly string[]} tools @param {string} [where]
 * @returns {void}
 */
export function assertGoldRoute(r, slots, tools, where = 'route') {
  const str = (v, at) => { if (typeof v !== 'string' || !v.length) fail(at, 'must be a non-empty string'); };
  str(r?.id, `${where}.id`);
  str(r.label, `${where}.label`);
  if (!GOLD_OUTCOMES.includes(r.outcome)) fail(`${where}.outcome`, 'must be change, refusal or question');
  if (!Array.isArray(r.steps)) fail(`${where}.steps`, 'must be an array');
  if (r.outcome === 'change' && r.steps.length === 0) fail(`${where}.steps`, 'a change route has at least one step');
  if (r.outcome === 'question' && r.steps.length !== 0) fail(`${where}.steps`, 'a question route has no steps');
  if (r.outcome === 'question') { str(r.question?.about, `${where}.question.about`); sentence(r.question.sentence, `${where}.question.sentence`); }
  if (r.outcome === 'refusal' && !r.refusal?.code && !r.refusal?.rule) fail(`${where}.refusal`, 'must name the code or the rule Construct refuses with');
  r.steps.forEach((s, i) => {
    if (!tools.includes(s.tool)) fail(`${where}.steps[${i}].tool`, `must be one of ${tools.join(', ')}`);
    if (!s.args || typeof s.args !== 'object') fail(`${where}.steps[${i}].args`, 'must be an object');
  });
  if (!Array.isArray(r.expect)) fail(`${where}.expect`, 'must be an array');
  if (r.outcome === 'change' && r.expect.length === 0) fail(`${where}.expect`, 'a change route has at least one check');
  r.expect.forEach((e, i) => assertExpr(e, `${where}.expect[${i}]`));
  if (r.cost !== r.steps.length) fail(`${where}.cost`, 'is the number of steps');
  if (!['low', 'medium', 'high'].includes(r.risk)) fail(`${where}.risk`, 'must be low, medium or high');
  if (!r.scope || !Array.isArray(r.scope.layers) || !Array.isArray(r.scope.features) || typeof r.scope.library !== 'boolean') fail(`${where}.scope`, 'must be {layers, features, library}');
  for (const m of JSON.stringify(r).matchAll(GOLD_SLOT)) if (!slots[m[2]]) fail(where, `uses slot ${m[2]}, which the case does not declare`);
}

// ------------------------------------------------------------------------------------------------ expressions
// A route's `expect` and `pre` are expressions of Line's one expression language (../contract.mjs LineExpr, evaluated
// by ../expr.mjs over ../facts.mjs buildFacts), written with its named checks (EXPR_CHECKS: hasItem, hasLibrary,
// basedOn, fileContains, propIs, noNewFindings, noFinding, ...) over slot refs; verify.mjs binds and evaluates them.

// ------------------------------------------------------------------------------------------------ structure
/** Closed delta ops of a route (what it does to the project's structure). */
export const DELTA_OPS = Object.freeze(['add-node', 'remove-node', 'move-node', 'add-edge', 'remove-edge', 'set-base', 'add-flow-state', 'remove-flow-state', 'add-flow-transition', 'remove-flow-transition']);
export const EDGE_TYPES = Object.freeze(['base', 'import']);

/**
 * One structural delta op, slot form. `node`/`from`/`to` are slot refs ("<F1>/components/<N1>", "<L1>", "<C1>").
 * @typedef {{op: string, node?: string, kind?: string, layer?: string, area?: 'feature'|'library', feature?: string, from?: string, to?: string, type?: string}} DeltaOp
 */

/**
 * Delexicalized structure hashes (../structure.mjs hashesOf): names never enter; kinds, roles, layers, base links and
 * import edges do. Renaming changes nothing; adding a page changes the feature and project hashes.
 * @typedef {{project: string, feature: string|null, layers: Record<string, string>}} StructureHashes
 */

// ------------------------------------------------------------------------------------------------ shapes
/**
 * A slot's structure (stored), never its name.
 * @typedef {{kind: string, area?: 'feature'|'library', itemKind?: string, layer?: string, role?: string, of?: string, layers?: string[], roles?: string[], counts?: Record<string, number>, valueType?: string, isNew?: boolean, handler?: boolean}} SlotShape
 */

/**
 * Closed labels from the classifier (static rules now).
 * @typedef {object} Labels
 * @property {{id: string, confidence: number}} intent       An INTENT_CATALOG id, or "unknown".
 * @property {{id: string, confidence: number}[]} alternatives Other intent ids, best first.
 * @property {boolean} inCatalog
 * @property {string|null} target                            The main slot (e.g. "F1"), or null.
 * @property {{layer: string, confidence: number}[]} layers  Candidate layers, tuned for recall.
 * @property {'rules'|'model'|'retrieval'} via  `retrieval`: a strong precedent (an approved request like this one) set the intent.
 */

/**
 * One route: a way to satisfy the request.
 * @typedef {object} Route
 * @property {string} id          Stable for the same request shape, e.g. "base-on:ui:L1>F1".
 * @property {string} template
 * @property {string} label       Plain English in slot form, e.g. "Add a component based on <L1> to <F1>.".
 * @property {string} intent
 * @property {{layers: string[], features: string[], library: string[], scope: string}} scope
 * @property {{tool: string, args: Record<string, unknown>}[]} steps  Slot-form args.
 * @property {object[]} expect    Slot-form expressions (Line's expression language, ../contract.mjs LineExpr).
 * @property {object[]} pre       Slot-form preconditions.
 * @property {DeltaOp[]} delta
 * @property {{feature: string|null, project: string}|null} predicted  Predicted structure hashes after the route.
 * @property {{steps: number, files: number, layers: number}} cost
 * @property {string} risk        One sentence.
 * @property {'template'|'retrieval'|'model'} via
 * @property {number} confidence  0..1
 * @property {string} status      ROUTE_STATUS
 * @property {{sentence: string, fix: {id: string, sentence: string, step: {tool: string, args: Record<string, unknown>}|null}|null, code?: string|null, rule?: string|null}|null} refusal  `code`: Construct's refusal code; `rule`: the first error finding's rule.
 * @property {string[]} invented  Slots a rule made up (a new name); Qwen may propose better ones.
 * @property {string[]} failed    Expectation sentences that did not hold after verification.
 */

/**
 * What draft() returns. `bindings` maps slots to the project's names; it is shown and applied, never stored.
 * @typedef {object} Draft
 * @property {string} request     Delexicalized.
 * @property {Record<string, SlotShape>} slots
 * @property {Labels} labels
 * @property {StructureHashes} from
 * @property {Route[]} routes
 * @property {{id: string, sentence: string}[]} dropped
 * @property {string|null} recommended
 * @property {{to: 'qwen'|'ask'|null, sentence: string, about?: string, choices?: string[]}} defer  `about` and `choices`: a closed
 *   question the drafter asks itself (no name or no library item given): its choices are the checked routes that answer it.
 * @property {Record<string, unknown>} bindings
 */

/**
 * A stored training record: one transition, delexicalized (no names of the project).
 * @typedef {object} TransitionRecord
 * @property {1} v
 * @property {string} request
 * @property {Record<string, SlotShape>} slots
 * @property {string} intent
 * @property {StructureHashes} from
 * @property {string} routeId
 * @property {string} template
 * @property {{tool: string, args: Record<string, unknown>}[]} steps
 * @property {object[]} expect
 * @property {DeltaOp[]} delta
 * @property {{feature: string|null, project: string}|null} to
 * @property {boolean} approved
 */

// ------------------------------------------------------------------------------------------------ checks
const fail = (where, why) => { throw new TypeError(`${where} ${why}`); };
const sentence = (s, where) => { if (typeof s !== 'string' || !/^\S.*[.?!]$/s.test(s)) fail(where, 'must be one full sentence'); };
const unit = (n, where) => { if (typeof n !== 'number' || !(n >= 0 && n <= 1)) fail(where, 'must be a number from 0 to 1'); };

/**
 * Throws unless l is Labels with closed values.
 * @param {any} l
 * @param {IntentEntry[]} catalog
 * @returns {void}
 */
export function assertLabels(l, catalog) {
  const ids = new Set(catalog.map((e) => e.id));
  if (l?.intent?.id !== 'unknown' && !ids.has(l?.intent?.id)) fail('labels.intent.id', 'must be a catalog id or "unknown"');
  unit(l.intent.confidence, 'labels.intent.confidence');
  if (l.inCatalog !== (l.intent.id !== 'unknown')) fail('labels.inCatalog', 'is true exactly when the intent is in the catalog');
  if (!Array.isArray(l.alternatives) || l.alternatives.some((a) => !ids.has(a.id))) fail('labels.alternatives', 'must be catalog ids');
  if (!Array.isArray(l.layers) || l.layers.some((x) => !LAYERS.includes(x.layer))) fail('labels.layers', `must be layers from ${LAYERS.join(', ')}`);
  l.layers.forEach((x, i) => unit(x.confidence, `labels.layers[${i}].confidence`));
  if (l.target !== null && !/^[A-Z]\d+$/.test(l.target)) fail('labels.target', 'must be a slot id like F1 or null');
}

/**
 * Throws unless d is a Draft: closed values, stable route ids, plain-English sentences, a recommended route that exists.
 * @param {any} d
 * @param {IntentEntry[]} catalog
 * @returns {void}
 */
export function assertDraft(d, catalog) {
  if (typeof d?.request !== 'string') fail('draft.request', 'must be a string');
  assertLabels(d.labels, catalog);
  if (!Array.isArray(d.routes)) fail('draft.routes', 'must be an array');
  const seen = new Set();
  d.routes.forEach((r, i) => {
    const w = `draft.routes[${i}]`;
    if (typeof r.id !== 'string' || !r.id || seen.has(r.id)) fail(`${w}.id`, 'must be a unique non-empty string'); seen.add(r.id);
    if (!TEMPLATES[r.template]) fail(`${w}.template`, 'must be a template name');
    sentence(r.label, `${w}.label`); sentence(r.risk, `${w}.risk`);
    if (!VIA.includes(r.via)) fail(`${w}.via`, `must be one of ${VIA.join(', ')}`);
    if (!ROUTE_STATUS.includes(r.status)) fail(`${w}.status`, `must be one of ${ROUTE_STATUS.join(', ')}`);
    unit(r.confidence, `${w}.confidence`);
    if (!Array.isArray(r.steps) || !r.steps.length) fail(`${w}.steps`, 'must have at least one step');
    r.steps.forEach((s, j) => { if (typeof s.tool !== 'string' || !s.args || typeof s.args !== 'object') fail(`${w}.steps[${j}]`, 'must be {tool, args}'); });
    if (!Array.isArray(r.expect) || !r.expect.length) fail(`${w}.expect`, 'must have at least one expression');
    r.expect.forEach((e, j) => assertExpr(e, `${w}.expect[${j}]`));
    if (!Array.isArray(r.delta) || r.delta.some((o) => !DELTA_OPS.includes(o.op))) fail(`${w}.delta`, 'must hold closed delta ops');
    if (r.status === 'refused') { if (!r.refusal) fail(`${w}.refusal`, 'a refused route says why'); sentence(r.refusal.sentence, `${w}.refusal.sentence`); }
    for (const k of ['steps', 'files', 'layers']) if (!Number.isInteger(r.cost?.[k])) fail(`${w}.cost.${k}`, 'must be a whole number');
  });
  d.dropped.forEach((x, i) => sentence(x.sentence, `draft.dropped[${i}].sentence`));
  if (d.recommended !== null && !seen.has(d.recommended)) fail('draft.recommended', 'must be a route id or null');
  if (![null, 'qwen', 'ask'].includes(d.defer?.to)) fail('draft.defer.to', 'must be null, "qwen" or "ask"');
  sentence(d.defer.sentence, 'draft.defer.sentence');
}

/**
 * Throws unless e is an expression of Line's expression language (../contract.mjs exprProblem); the message says why.
 * @param {any} e
 * @param {string} [where]
 * @returns {void}
 */
export function assertExpr(e, where = 'expr') {
  const why = exprProblem(e);
  if (why) fail(where, `is not an expression: ${why}`);
}

/**
 * Throws if a stored record holds any of the given project identifiers (the delexicalization guarantee).
 * @param {unknown} record
 * @param {string[]} identifiers Every name from the project's facts (feature, item, library, prop names).
 * @returns {void}
 */
export function assertNoIdentifiers(record, identifiers) {
  const id = projectWordIn(record, identifiers);
  if (id) fail('record', `holds the project name "${id}"; store slots instead`);
}
