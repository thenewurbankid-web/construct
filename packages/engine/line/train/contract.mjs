// Train Line (owner, 2026-10-11): one place where the owner and Claude train Line's System 1 drafter on the solid,
// tested Line tools only (line.baseOn, line.promote, line.setPageProp, line.setFragment, line.fix). This file is the
// contract: shapes, the closed lists, the HTTP routes and the runtime shape checks. No logic beyond the checks.
//
//   cases       packages/engine/line/train/store.mjs     line/train/cases.jsonl + log.jsonl, through Construct's writer
//   worlds      packages/engine/line/train/corpus.mjs    imaginary Line projects (scratch only, never a real project)
//   verify      packages/engine/line/train/verify.mjs    "Try it": a route's steps in a scratch copy, its checks
//   drafter     packages/engine/line/train/drafterMirror.mjs   MIRROR of the drafter contract; replace on merge
//   checks      packages/engine/line/expr.mjs               Line's one expression language (named checks)
//   intents     INTENTS below                                  MIRROR of the drafter's intent catalog; replace on merge
//   server      ui/server/src/lineTrainApi.mjs           TRAIN_API under /api/line/train
//   agents      packages/mcp/src/train.mjs               train_propose_case, train_list_cases, train_run_eval
//
// Owner rules kept here:
// - Cases are stored DELEXICALIZED: no project or domain word is ever saved. Every name is a typed slot
//   ("Make <name:N1> in <feature:F1>, based on <library:L1>.") whose `ref` points into the world's facts by position
//   (feature#0, library:components#1, ...). The screen fills the names back from the world's facts.
// - A case's gold is the SET of valid routes plus the preferred one; every gold route is verified by Construct (its
//   steps apply in a scratch copy through applyChange and its checks pass; a refusal route must be refused, with its
//   typed fixes when it names a rule).
// - Claude proposes (labelledBy 'claude', status 'draft'); only the owner moves a case to 'agreed' or 'disputed'.
//   Every change is logged with who made it.

/** The five solid tools: the only ones Train Line offers. */
export const TRAIN_TOOLS = Object.freeze(['line.baseOn', 'line.promote', 'line.setPageProp', 'line.setFragment', 'line.fix']);

/** Plain-English tool family names for the scoreboard. */
export const TOOL_FAMILY_LABEL = Object.freeze({
  'line.baseOn': 'Make from the library',
  'line.promote': 'Move into the library',
  'line.setPageProp': 'Set a page value',
  'line.setFragment': 'Edit a piece of code',
  'line.fix': 'Fix a problem',
  none: 'Refuse or ask',
});

/**
 * MIRROR of the drafter's closed intent catalog (verb x structural object, stable ids); replace on merge.
 * `family` is the tool family the intent's preferred route uses ('none' for a refusal or a question).
 */
export const INTENTS = Object.freeze([
  { id: 'add.component', phrase: 'Add a component to a feature', family: 'line.baseOn' },
  { id: 'add.page', phrase: 'Add a page to a feature', family: 'line.baseOn' },
  { id: 'add.flow', phrase: 'Add a flow to a feature', family: 'line.baseOn' },
  { id: 'add.sample-data', phrase: 'Add sample data to a feature', family: 'line.baseOn' },
  { id: 'share.item', phrase: 'Share a feature\'s item with other features', family: 'line.promote' },
  { id: 'move.item-to-library', phrase: 'Move a feature\'s item into the library', family: 'line.promote' },
  { id: 'update.page-text', phrase: 'Change a text on a page', family: 'line.setPageProp' },
  { id: 'update.variable', phrase: 'Update a value on a page', family: 'line.setPageProp' },
  { id: 'update.feature-flow', phrase: 'Update what a feature\'s page does', family: 'line.setFragment' },
  { id: 'fix.problem', phrase: 'Fix a reported problem', family: 'line.fix' },
  { id: 'refuse.not-possible', phrase: 'Something Line must refuse', family: 'none' },
  { id: 'ask.missing-detail', phrase: 'Something Line must ask about first', family: 'none' },
]);
export const INTENT_IDS = Object.freeze(INTENTS.map((i) => i.id));

/** Slot types. `ref` points into the world's facts by position; `role` is a structural word, never a domain word. */
export const SLOT_TYPES = Object.freeze(['feature', 'library', 'item', 'name', 'text', 'number', 'fragment', 'code', 'finding', 'fix', 'missing']);

/**
 * A typed slot of a delexicalized case.
 * @typedef {object} TrainSlot
 * @property {'feature'|'library'|'item'|'name'|'text'|'number'|'fragment'|'code'|'finding'|'fix'|'missing'} type
 * @property {string} [ref]      Position in the world's facts: "feature#0", "library:components#1", "item:feature#0/pages#0",
 *                               "finding#0", "word#2" (a world word, for texts), "fragment#0" (of `of`).
 * @property {string} [kind]     Line kind (components, pages, workflows, fixtures) where it matters.
 * @property {string} [role]     A structural role word for a new name ("status", "summary"): the name is Role + the name of `of`.
 * @property {string} [of]       Another slot this one is derived from (a name from a library item, a fix of a finding, a fragment of an item).
 * @property {number} [rank]     A fix slot: the fix's rank among the finding's typed fixes (1 = recommended).
 * @property {string|number|boolean} [literal]  A value typed by the owner that names nothing in the facts (numbers, plain words).
 */

/**
 * One step of a route, args slotted ("<feature:F1>"; a whole-arg slot or a slot inside a string).
 * @typedef {{tool: string, args: Record<string, unknown>}} TrainStep
 */

/**
 * One way to do a request. `outcome` says what Line should do: make the change, refuse it, or ask first.
 * @typedef {object} TrainRoute
 * @property {string} id
 * @property {string} label      Plain English, slotted: "Inside <feature:F1> only".
 * @property {{layers: string[], features: string[], library: boolean}} scope  What it touches (features as slot names).
 * @property {TrainStep[]} steps
 * @property {object[]} expect   Expressions (Line's one expression language, ../expr.mjs; its named checks) that define done; slotted.
 * @property {number} cost       Number of steps.
 * @property {'low'|'medium'|'high'} risk  low: one feature; medium: the library (every feature that uses it).
 * @property {'change'|'refusal'|'question'} outcome
 * @property {{code?: string, rule?: string, fixes?: boolean}} [refusal]  A refusal route: what Construct must say.
 * @property {{about: string, sentence: string}} [question]  A question route: what Line must ask (slotted sentence).
 */

/**
 * A training case, as stored (delexicalized).
 * @typedef {object} TrainCase
 * @property {string} id
 * @property {string} intent      One of INTENT_IDS.
 * @property {string} request     Plain English, slotted.
 * @property {Record<string, TrainSlot>} slots
 * @property {{kind: 'corpus', id: string, variant: string}|{kind: 'sample'}} world  Which imaginary project the slots point into.
 * @property {'train'|'heldout'} split  Held out by whole world (every case of a held-out world), so eval measures generalisation.
 * @property {string} factsHash   sha256 of the world's facts the slots were bound to.
 * @property {{routes: TrainRoute[], preferred: string}} gold
 * @property {'owner'|'claude'} labelledBy
 * @property {'draft'|'agreed'|'disputed'} status
 * @property {{by: 'owner'|'claude', text: string, at: string}[]} notes
 * @property {boolean} sample     In the random sample the owner reviews.
 * @property {{routes: Record<string, {ok: boolean, at: string}>}} verified  Construct's verdict per gold route.
 * @property {string} createdAt
 */

/**
 * A case as the screen shows it: the stored case plus its names filled back from the world's facts.
 * @typedef {TrainCase & {filled: {request: string, intentPhrase: string, routes: FilledRoute[]}}} TrainCaseView
 * @typedef {{id: string, label: string, touches: string, steps: {tool: string, args: Record<string, unknown>, sentence: string}[], checks: string[], cost: number, risk: string, outcome: string, preferred: boolean, sentence?: string}} FilledRoute
 */

/**
 * The drafter's answer (MIRROR of the drafter contract; replace on merge).
 * @typedef {{routes: (TrainRoute & {via: 'template'|'retrieval'|'model', confidence: number})[], recommended: string|null, intent: string, via: 'template'|'retrieval'|'model', confidence: number, slots: Record<string, TrainSlot>, request: string}} TrainDraft
 */

/**
 * "Try it": one route run in a scratch copy of the world (never the real project).
 * @typedef {{ok: boolean, sentence: string, steps: {sentence: string, ok: boolean, code?: string}[], checks: {sentence: string, ok: boolean}[]}} TryResult
 */

/**
 * The scoreboard: per tool family and per intent.
 * @typedef {{cases: number, heldout: number, recall: number|null, precision: number|null, preferred: number|null, noRepair: number|null, sampled: number, agreed: number, disagreed: number, agreement: number|null}} ScoreRow
 * @typedef {{ok: true, lastRun: string|null, byFamily: Record<string, ScoreRow>, byIntent: Record<string, ScoreRow>, total: ScoreRow, sentence: string}} Scoreboard
 */

/** The HTTP API ui/server serves under /api/line/train. A refusal is a 400 `{ok: false, sentence, code}`. */
export const TRAIN_API = Object.freeze([
  { method: 'GET', path: '/api/line/train/worlds', request: null, response: '{worlds: {id, label, kind}[]}' },
  { method: 'GET', path: '/api/line/train/cases', request: 'filter (query: sample|mine|claude|all), limit', response: '{cases: TrainCaseView[]}' },
  { method: 'GET', path: '/api/line/train/facts', request: 'world (query)', response: 'WorldChoices' },
  { method: 'POST', path: '/api/line/train/draft', request: '{request, world}', response: 'TrainDraft & {filled}' },
  { method: 'POST', path: '/api/line/train/try', request: '{world, slots, route}', response: 'TryResult' },
  { method: 'POST', path: '/api/line/train/preview', request: '{world, request, slots, routes, preferred}', response: '{ok, request, routes: FilledRoute[]}' },
  { method: 'POST', path: '/api/line/train/route', request: '{world, slots, tool, args, label?}', response: '{slots, route: TrainRoute}' },
  { method: 'POST', path: '/api/line/train/synonym', request: '{world, word, ref}', response: '{ok, sentence}' },
  { method: 'POST', path: '/api/line/train/cases', request: '{world, request, intent, slots, routes, preferred}', response: '{case: TrainCaseView}' },
  { method: 'POST', path: '/api/line/train/review', request: '{id, verdict: agree|disagree, note?}', response: '{case: TrainCaseView}' },
  { method: 'POST', path: '/api/line/train/eval', request: null, response: 'Scoreboard' },
  { method: 'GET', path: '/api/line/train/scoreboard', request: null, response: 'Scoreboard' },
]);

// ---------------------------------------------------------------------------------------------- shape checks
const fail = (where, what) => { throw new TypeError(`${where}: ${what}`); };
const str = (v, where) => (typeof v === 'string' && v.length > 0) || fail(where, 'must be a non-empty string');
const sentence = (v, where) => { str(v, where); if (!/^\S.*[.?!]$/s.test(v)) fail(where, `must be a full sentence ending in . ? or !: ${JSON.stringify(v)}`); };
const SLOT_RE = /<([a-z]+):([A-Z][A-Za-z]*\d+)>/g;

/**
 * The slot names a slotted string uses ("<feature:F1>" -> F1), in order of appearance.
 * @param {string} text A slotted string.
 * @returns {string[]}
 */
export function slotNamesIn(text) {
  return [...String(text).matchAll(SLOT_RE)].map((m) => m[2]);
}

/**
 * Throws unless r is a TrainRoute whose every slot is declared in `slots`.
 * @param {any} r @param {Record<string, any>} slots @param {string} [where]
 */
export function assertTrainRoute(r, slots, where = 'route') {
  str(r?.id, `${where}.id`);
  str(r.label, `${where}.label`);
  if (!['change', 'refusal', 'question'].includes(r.outcome)) fail(`${where}.outcome`, 'must be change, refusal or question');
  if (!Array.isArray(r.steps)) fail(`${where}.steps`, 'must be an array');
  if (r.outcome === 'change' && r.steps.length === 0) fail(`${where}.steps`, 'a change route has at least one step');
  if (r.outcome === 'question' && r.steps.length !== 0) fail(`${where}.steps`, 'a question route has no steps');
  if (r.outcome === 'question') { str(r.question?.about, `${where}.question.about`); sentence(r.question.sentence, `${where}.question.sentence`); }
  if (r.outcome === 'refusal' && !r.refusal?.code && !r.refusal?.rule) fail(`${where}.refusal`, 'must name the code or the rule Construct refuses with');
  r.steps.forEach((s, i) => {
    if (!TRAIN_TOOLS.includes(s.tool)) fail(`${where}.steps[${i}].tool`, `must be one of ${TRAIN_TOOLS.join(', ')}`);
    if (!s.args || typeof s.args !== 'object') fail(`${where}.steps[${i}].args`, 'must be an object');
  });
  if (!Array.isArray(r.expect)) fail(`${where}.expect`, 'must be an array');
  if (r.outcome === 'change' && r.expect.length === 0) fail(`${where}.expect`, 'a change route has at least one check');
  if (r.cost !== r.steps.length) fail(`${where}.cost`, 'is the number of steps');
  if (!['low', 'medium', 'high'].includes(r.risk)) fail(`${where}.risk`, 'must be low, medium or high');
  if (!r.scope || !Array.isArray(r.scope.layers) || !Array.isArray(r.scope.features) || typeof r.scope.library !== 'boolean') fail(`${where}.scope`, 'must be {layers, features, library}');
  for (const name of slotNamesIn(JSON.stringify(r))) if (!slots[name]) fail(where, `uses slot ${name}, which the case does not declare`);
}

/**
 * Throws unless c is a stored TrainCase (delexicalized, gold routes with a preferred one, a known intent).
 * @param {any} c
 * @returns {asserts c is TrainCase}
 */
export function assertTrainCase(c) {
  str(c?.id, 'case.id');
  if (!INTENT_IDS.includes(c.intent)) fail('case.intent', `must be one of the intent catalog (${c.intent})`);
  sentence(c.request, 'case.request');
  if (!c.slots || typeof c.slots !== 'object') fail('case.slots', 'must be an object');
  for (const [k, s] of Object.entries(c.slots)) {
    if (!/^[A-Z][A-Za-z]*\d+$/.test(k)) fail(`case.slots.${k}`, 'a slot name is a capital letter and a number, e.g. F1');
    if (!SLOT_TYPES.includes(s?.type)) fail(`case.slots.${k}.type`, `must be one of ${SLOT_TYPES.join(', ')}`);
  }
  for (const name of slotNamesIn(c.request)) if (!c.slots[name]) fail('case.request', `uses slot ${name}, which the case does not declare`);
  if (c.world?.kind !== 'sample' && !(c.world?.kind === 'corpus' && typeof c.world.id === 'string')) fail('case.world', 'must be the sample or a corpus world');
  if (!['train', 'heldout'].includes(c.split)) fail('case.split', 'must be train or heldout');
  str(c.factsHash, 'case.factsHash');
  if (!Array.isArray(c.gold?.routes) || c.gold.routes.length === 0) fail('case.gold.routes', 'must hold at least one route');
  const ids = new Set();
  c.gold.routes.forEach((r, i) => { assertTrainRoute(r, c.slots, `case.gold.routes[${i}]`); if (ids.has(r.id)) fail(`case.gold.routes[${i}].id`, 'must be unique'); ids.add(r.id); });
  if (!ids.has(c.gold.preferred)) fail('case.gold.preferred', 'must be one of the gold routes');
  if (!['owner', 'claude'].includes(c.labelledBy)) fail('case.labelledBy', 'must be owner or claude');
  if (!['draft', 'agreed', 'disputed'].includes(c.status)) fail('case.status', 'must be draft, agreed or disputed');
  if (c.status === 'disputed' && !c.notes?.some((n) => n.by === 'owner')) fail('case.status', 'a disputed case carries the owner\'s note');
  if (!Array.isArray(c.notes)) fail('case.notes', 'must be an array');
  if (typeof c.sample !== 'boolean') fail('case.sample', 'must be a boolean');
}

/**
 * Throws unless the stored case text contains none of `words` (the world's identifiers and domain words), compared
 * as whole words, case-insensitively. The owner's rule: only structure, kinds, roles, layers, tools and checks are saved.
 * @param {string} storedLine The case as saved (one JSON line).
 * @param {string[]} words
 */
export function assertDelexicalized(storedLine, words) {
  const lowered = storedLine.toLowerCase();
  for (const w of words) {
    const word = w.toLowerCase();
    if (word.length < 3) continue;
    const re = new RegExp(`(^|[^a-z0-9])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
    if (re.test(lowered)) fail('case', `contains the project word "${w}"; store it as a slot`);
  }
}

/**
 * Throws unless t is a TryResult: ok, one sentence, and its steps and checks as sentences.
 * @param {any} t
 * @returns {asserts t is TryResult}
 */
export function assertTryResult(t) {
  if (typeof t?.ok !== 'boolean') fail('try.ok', 'must be a boolean');
  sentence(t.sentence, 'try.sentence');
  if (!Array.isArray(t.steps) || !Array.isArray(t.checks)) fail('try', 'steps and checks must be arrays');
  t.steps.forEach((s, i) => sentence(s.sentence, `try.steps[${i}].sentence`));
  t.checks.forEach((s, i) => sentence(s.sentence, `try.checks[${i}].sentence`));
}

/**
 * Throws unless b is a Scoreboard: rows per tool family and per intent, shares between 0 and 1 or null.
 * @param {any} b
 * @returns {asserts b is Scoreboard}
 */
export function assertScoreboard(b) {
  if (b?.ok !== true) fail('scoreboard.ok', 'must be true');
  sentence(b.sentence, 'scoreboard.sentence');
  for (const [k, rows] of [['byFamily', b.byFamily], ['byIntent', b.byIntent]]) {
    if (!rows || typeof rows !== 'object') fail(`scoreboard.${k}`, 'must be an object');
    for (const [name, row] of Object.entries(rows)) assertRow(row, `scoreboard.${k}.${name}`);
  }
  assertRow(b.total, 'scoreboard.total');
}
function assertRow(r, where) {
  for (const k of ['cases', 'heldout', 'sampled', 'agreed', 'disagreed']) if (!Number.isInteger(r?.[k]) || r[k] < 0) fail(`${where}.${k}`, 'must be a count');
  for (const k of ['recall', 'precision', 'preferred', 'noRepair', 'agreement']) if (r[k] !== null && !(typeof r[k] === 'number' && r[k] >= 0 && r[k] <= 1)) fail(`${where}.${k}`, 'must be a share between 0 and 1, or null');
}
