// Beam planner contract (epic "Plan = fit the request into the Trace map, by parallel runs").
// Two closed shapes other agents build against:
//   1. Reading: one candidate reading of a request (top-k drop-in for drafter classify(): same closed ids).
//   2. BeamEvent: one line of events.jsonl the beam streams (runOpened, runClosed, runRanked, question, done).
// Pure: no I/O, no model.

/** Beam cap: at most this many runs stay open at once. */
export const BEAM_CAP = 8;

/** Event kinds, in the order a run can produce them. Closed. */
export const EVENT_KINDS = Object.freeze(['runOpened', 'runClosed', 'runRanked', 'question', 'done']);

/**
 * Why a run was closed: the prune stage that closed it, cheapest first. Closed set; `detail` carries the sentence.
 * - shape:        the run's match/plan failed the zod shape or the Trace contract.
 * - structural:   applyStructural (structural-gate) refused a part.
 * - precondition: a Line precondition (checkPre over buildFacts, or a plan* dry run) failed where a Trace node maps to a Line step.
 * - emit:         the scratch emit (write transaction, never committed) or tsc failed.
 * - goal:         a goal condition (Line expression) evaluated false.
 * - cap:          ranked below the beam cap.
 * - duplicate:    the same plan as a run already open.
 * - won:          another run met every goal condition first (closed without fault).
 * - forked:       the run split into its children at a fork point (closed without fault; the children carry on).
 */
export const CLOSE_REASONS = Object.freeze(['shape', 'structural', 'precondition', 'emit', 'goal', 'cap', 'duplicate', 'won', 'forked']);

/** How the beam ended: one plan for approval, one closed question, or nothing survived. */
export const DONE_OUTCOMES = Object.freeze(['plan', 'question', 'none']);

/**
 * One candidate reading of a request: a closed tuple plus confidence. A list of these (best first) is the top-k
 * form of drafter `classify()` output (`Labels`, packages/engine/line/drafter/contract.mjs): `intent` is a
 * buildIntentCatalog id (or "unknown"), `target` a slot id like "F1" (or null), `layers` the candidate layers.
 * `toReadings(labels)` turns one Labels into readings, so a top-k classifier can replace classify() one for one.
 * @typedef {object} Reading
 * @property {string} intent      An intent catalog id ("update.handler") or "unknown".
 * @property {string|null} object The catalog object of the intent ("handler"), or null when unknown.
 * @property {string|null} target The target slot id ("F1"), or null.
 * @property {string[]} layers    Layer ids, best first ("ui", "workflow", "api", "data", "library").
 * @property {number} confidence  0..1.
 */

/**
 * A fork point: where a run was trimmed to one candidate.
 * @typedef {object} ForkChoice
 * @property {string} point   Stable id of the multi-candidate point, e.g. "candidates:<placeholder>", "list.sort", "forms", "ref:<name>".
 * @property {string} pick    Stable id of the candidate this run kept.
 * @property {string} label   Plain English for the pick.
 */

/**
 * The one closed question asked when several runs survive. Same plain shape as ImportQuestion
 * (packages/engine/line/contract.mjs): options are the surviving runs, recommended first, never free text.
 * @typedef {object} BeamQuestion
 * @property {string} id          Stable: "beam:<request hash>".
 * @property {string} sentence    The question in plain English.
 * @property {string} hint        Why the recommended option, one sentence naming the deciding rule.
 * @property {{id: string, sentence: string, effect: string}[]} options  id = run id; `effect`: what choosing it does.
 * @property {string} recommended An option id (listed first).
 */

/**
 * One line of events.jsonl.
 * @typedef {{t: 'runOpened', run: string, parent: string|null, reading: Reading, forks: ForkChoice[]}
 *   | {t: 'runClosed', run: string, reason: string, detail: string}
 *   | {t: 'runRanked', run: string, score: number, rank: number, why: string[]}
 *   | {t: 'question', question: BeamQuestion}
 *   | {t: 'done', outcome: 'plan'|'question'|'none', run: string|null, open: number, closed: number}} BeamEvent
 */

/**
 * One plan step a winning run becomes (for approval). Same id/tool/args/sentence shape as Line's ImportStep.
 * @typedef {object} BeamStep
 * @property {string} id        Stable: "trace-<n>-<slug>".
 * @property {'trace.emit'} tool
 * @property {{feature: string, file: string, layer: string, forks: Record<string, string>}} args  `forks`: point -> pick.
 * @property {string} sentence  What the step does, in plain English.
 */

/**
 * What planBeam returns (and what `done` sums up).
 * @typedef {object} BeamResult
 * @property {'plan'|'question'|'none'} outcome
 * @property {{run: string, steps: BeamStep[]}|null} plan       outcome "plan": the one run that met every goal.
 * @property {BeamQuestion|null} question                       outcome "question": the surviving runs as options.
 * @property {Record<string, {forks: ForkChoice[], reading: Reading, closed: {reason: string, detail: string}|null, score: number|null}>} runs
 * @property {BeamEvent[]} events                               Everything streamed to events.jsonl, in order.
 */

const isNum01 =(x) => typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 1;
const isStr = (x) => typeof x === 'string' && x.length > 0;
/** @param {string} where @param {string} msg @returns {never} */
function fail(where, msg) { throw new Error(`beam contract: ${where} ${msg}`); }

/**
 * Throws unless r is a Reading with closed values.
 * @param {any} r
 * @param {{id: string}[]} [catalog]  The intent catalog (buildIntentCatalog); when given, intent must be in it.
 * @returns {void}
 */
export function assertReading(r, catalog) {
  if (!r || typeof r !== 'object') fail('reading', 'must be an object');
  if (!isStr(r.intent)) fail('reading.intent', 'must be a string');
  if (catalog && r.intent !== 'unknown' && !catalog.some((e) => e.id === r.intent)) fail('reading.intent', `"${r.intent}" is not a catalog id`);
  if (r.object !== null && !isStr(r.object)) fail('reading.object', 'must be a string or null');
  if (r.intent !== 'unknown' && r.object !== r.intent.split('.')[1]) fail('reading.object', 'must be the intent\'s object');
  if (r.target !== null && !isStr(r.target)) fail('reading.target', 'must be a slot id or null');
  if (!Array.isArray(r.layers) || !r.layers.every(isStr)) fail('reading.layers', 'must be strings');
  if (!isNum01(r.confidence)) fail('reading.confidence', 'must be 0..1');
}

/**
 * Drafter classify() Labels -> top-k readings, best first (the intent, then its alternatives). Every reading shares
 * the target and the layers whose confidence is at least `minLayer`.
 * @param {{intent: {id: string, confidence: number}, alternatives?: {id: string, confidence: number}[], target: string|null, layers?: {layer: string, confidence: number}[]}} labels
 * @param {{k?: number, minLayer?: number}} [opts]
 * @returns {Reading[]}
 */
export function toReadings(labels, { k = 4, minLayer = 0.4 } = {}) {
  const layers = (labels.layers ?? []).filter((l) => l.confidence >= minLayer).map((l) => l.layer);
  const seen = new Set();
  /** @type {Reading[]} */
  const out = [];
  for (const { id, confidence } of [labels.intent, ...(labels.alternatives ?? [])]) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ intent: id, object: id === 'unknown' ? null : (id.split('.')[1] ?? null), target: labels.target ?? null, layers, confidence });
  }
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, k);
}

/**
 * Throws unless q is a closed BeamQuestion (at least two options, recommended listed first).
 * @param {any} q
 * @returns {void}
 */
export function assertBeamQuestion(q) {
  if (!q || !isStr(q.id) || !isStr(q.sentence) || typeof q.hint !== 'string') fail('question', 'needs id, sentence, hint');
  if (!Array.isArray(q.options) || q.options.length < 2) fail('question.options', 'needs at least two options');
  if (!q.options.every((o) => isStr(o.id) && isStr(o.sentence) && typeof o.effect === 'string')) fail('question.options', 'must be {id, sentence, effect}');
  if (q.options[0].id !== q.recommended) fail('question.recommended', 'must be the first option');
}

/**
 * Throws unless e is a BeamEvent.
 * @param {any} e
 * @returns {void}
 */
export function assertBeamEvent(e) {
  if (!e || !EVENT_KINDS.includes(e.t)) fail('event.t', `must be one of ${EVENT_KINDS.join(', ')}`);
  if (e.t !== 'question' && e.t !== 'done' && !isStr(e.run)) fail('event.run', 'must be a run id');
  if (e.t === 'runOpened') {
    assertReading(e.reading);
    if (!Array.isArray(e.forks) || !e.forks.every((f) => isStr(f.point) && isStr(f.pick) && typeof f.label === 'string')) fail('event.forks', 'must be ForkChoice[]');
  }
  if (e.t === 'runClosed' && !CLOSE_REASONS.includes(e.reason)) fail('event.reason', `must be one of ${CLOSE_REASONS.join(', ')}`);
  if (e.t === 'runRanked' && (typeof e.score !== 'number' || !Number.isInteger(e.rank) || !Array.isArray(e.why))) fail('event', 'runRanked needs score, rank, why[]');
  if (e.t === 'question') assertBeamQuestion(e.question);
  if (e.t === 'done' && !DONE_OUTCOMES.includes(e.outcome)) fail('event.outcome', `must be one of ${DONE_OUTCOMES.join(', ')}`);
}
