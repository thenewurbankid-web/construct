// im3 + j5 -- Line's memory of past answers per step: every change a person or an agent makes to what Line proposed
// (a drafted route picked, a plan step approved or refused, a fix picked, an import step edited, skipped or moved, a
// Train case agreed with) is one slotted MemoryRecord in `<state>/memory/<step>.jsonl`, written through Construct's
// writer (writeLineState, append under the file lock), per project, never sent anywhere. Recall works over these
// records only, never over source code: exact match on step + intent + structure, then similarity over slot and
// structure features (slot overlap, structure-neighbourhood Jaccard, BM25 over slot tokens). Optional local
// embeddings (off by default) embed ONLY the record's slotted decision text.
//
// A record holds no domain word (the shared leak guard, line/slots.mjs) and no code text (the graph contract's rule:
// no braces, semicolons, arrows, JSX tags or line breaks).
//
// Memory only reorders or seeds options Construct already checked; it never adds one.

/**
 * What happened to a proposal.
 *   picked      a drafted route was picked (chosen = the route's key)
 *   approved    a proposed plan step was approved as proposed
 *   refused     a proposed step or change was refused (by a person, or by Construct when it ran)
 *   edited      a proposed step was changed before it ran
 *   skipped     a proposed step was skipped
 *   reordered   a proposed step was moved in the plan
 *   fix-picked  one of a refusal's typed fixes was picked (chosen = the fix id)
 *   agreed      a person agreed with a proposed answer (Train Line)
 *   disagreed   a person disagreed with a proposed answer (Train Line)
 * @typedef {'picked'|'approved'|'refused'|'edited'|'skipped'|'reordered'|'fix-picked'|'agreed'|'disagreed'} MemoryOutcomeKind
 */

/**
 * What Line (static, a model or jev) proposed, slotted. `options` are closed option keys (a route key such as
 * "via-library:ui:I>F", a fix id, a tool name); `proposed` is the one Line recommended (null when none).
 * `structure` is a structure hash key (structure.mjs: the feature hash, else the project hash), `slots` the slot-shape
 * tokens ("F:feature", "C:component on:atom"), `neighbourhood` structural ids (hashes or kind tokens, never names).
 * @typedef {{intent: string, structure: string|null, slots: string[], neighbourhood: string[], options: string[], proposed: string|null}} MemoryProposal
 */

/**
 * What the person or agent did with it. `chosen` is the option kept (null for a refusal or skip without one).
 * @typedef {{kind: MemoryOutcomeKind, chosen: string|null, by: 'person'|'agent'|'line'}} MemoryOutcome
 */

/**
 * One stored record (one line of `<state>/memory/<step>.jsonl`).
 * @typedef {{v: 1, id: string, step: string, at: string, intent: string, structure: string|null, slots: string[], neighbourhood: string[],
 *   options: string[], proposed: string|null, kind: MemoryOutcomeKind, chosen: string|null, by: 'person'|'agent'|'line', agreed: boolean}} MemoryRecord
 */

/**
 * One recalled record and why it was recalled.
 * @typedef {{record: MemoryRecord, score: number, how: 'exact'|'similar'|'embedding'}} Recalled
 */

/**
 * A preference memory found among the checked options: the option, how many past decisions back it, and the sentence.
 * @typedef {{option: string, count: number, of: number, sentence: string}} MemoryPreference
 */

/**
 * GET /api/line/memory: the open project's memory, per step.
 * @typedef {{ok: true, steps: {step: string, label: string, size: number}[], total: number, sentence: string}} MemoryView
 */

export const MEMORY_VERSION = 1;
/** Where a project's memory lives, under its Line state folder. */
export const MEMORY_DIR = 'memory';
export const MEMORY_OUTCOMES = Object.freeze(/** @type {MemoryOutcomeKind[]} */ (['picked', 'approved', 'refused', 'edited', 'skipped', 'reordered', 'fix-picked', 'agreed', 'disagreed']));
/** Outcomes that vote FOR `chosen`, and those that vote AGAINST `proposed`. */
export const FOR_CHOSEN = Object.freeze(/** @type {MemoryOutcomeKind[]} */ (['picked', 'approved', 'fix-picked', 'agreed', 'edited']));
export const AGAINST_PROPOSED = Object.freeze(/** @type {MemoryOutcomeKind[]} */ (['refused', 'skipped', 'disagreed']));
export const MEMORY_BY = Object.freeze(/** @type {('person'|'agent'|'line')[]} */ (['person', 'agent', 'line']));
/** How many consistent past picks it takes before memory reorders the options. */
export const MIN_CONSISTENT = 3;
/** The memory steps Line feeds today (a decide() profile step may also keep memory). */
export const MEMORY_STEPS = Object.freeze({
  'drafter.route': 'Which drafted route you pick',
  'plan.step': 'What happens to a proposed plan step',
  'plan.fix': 'Which fix you pick for a refused step',
  'import.step': 'How you change the Import plan',
  'train.route': 'Which route you agree with in Train Line',
});
/** A step id is also its file name. */
export const STEP_ID = /^[a-z][a-z0-9.-]{1,60}$/;
/** An option key: a closed id (route key, fix id, tool name). */
export const OPTION_KEY = /^[A-Za-z0-9:._>+@=/-]{1,120}$/;
/** Code text never belongs in memory: no braces, semicolons, arrows, JSX tags or line breaks. */
export const CODE_LIKE = /[{};\n`]|=>|<\/?[A-Za-z]/;
export const MAX_TEXT = 160;
export const MAX_LIST = 40;

const fail = (where, what) => { throw new TypeError(`${where} must ${what}.`); };
const shortText = (v, where) => { if (typeof v !== 'string' || !v || v.length > MAX_TEXT || CODE_LIKE.test(v)) fail(where, `be short text of at most ${MAX_TEXT} characters with no code in it`); };
const list = (v, where, each) => {
  if (!Array.isArray(v) || v.length > MAX_LIST) fail(where, `be a list of at most ${MAX_LIST}`);
  v.forEach((x, i) => each(x, `${where}[${i}]`));
};
const key = (v, where) => { if (typeof v !== 'string' || !OPTION_KEY.test(v)) fail(where, 'be a closed option key (letters, digits and : . _ > + @ = / -)'); };

/**
 * Throw a one-sentence TypeError unless `r` is a MemoryRecord (shape only; the leak guard is the store's).
 * @param {any} r
 * @returns {asserts r is MemoryRecord}
 */
export function assertMemoryRecord(r) {
  if (!r || typeof r !== 'object' || Array.isArray(r)) fail('A memory record', 'be an object');
  if (r.v !== MEMORY_VERSION) fail("A memory record's v", `be ${MEMORY_VERSION}`);
  if (typeof r.id !== 'string' || !/^m-[a-z0-9]{6,32}$/.test(r.id)) fail("A memory record's id", 'be "m-" and 6 to 32 letters or digits');
  if (typeof r.step !== 'string' || !STEP_ID.test(r.step)) fail("A memory record's step", 'be a step id');
  if (typeof r.at !== 'string' || Number.isNaN(Date.parse(r.at))) fail("A memory record's at", 'be a date');
  shortText(r.intent, "A memory record's intent");
  if (r.structure !== null) shortText(r.structure, "A memory record's structure");
  list(r.slots, "A memory record's slots", shortText);
  list(r.neighbourhood, "A memory record's neighbourhood", shortText);
  list(r.options, "A memory record's options", key);
  if (r.proposed !== null) key(r.proposed, "A memory record's proposed");
  if (!MEMORY_OUTCOMES.includes(r.kind)) fail("A memory record's kind", `be one of ${MEMORY_OUTCOMES.join(', ')}`);
  if (r.chosen !== null) key(r.chosen, "A memory record's chosen");
  if (!MEMORY_BY.includes(r.by)) fail("A memory record's by", `be one of ${MEMORY_BY.join(', ')}`);
  if (typeof r.agreed !== 'boolean') fail("A memory record's agreed", 'be true or false');
  const extra = Object.keys(r).filter((k) => !['v', 'id', 'step', 'at', 'intent', 'structure', 'slots', 'neighbourhood', 'options', 'proposed', 'kind', 'chosen', 'by', 'agreed'].includes(k));
  if (extra.length) fail(`A memory record (${r.id})`, `carry only its own fields, not ${extra.join(', ')}`);
}

/**
 * A memory export (round-trips through import): the records per step, never the project's names.
 * @typedef {{v: 1, kind: 'line-memory', steps: Record<string, MemoryRecord[]>}} MemoryExport
 */

/**
 * Throw a one-sentence TypeError unless `x` is a MemoryExport.
 * @param {any} x
 * @returns {asserts x is MemoryExport}
 */
export function assertMemoryExport(x) {
  if (!x || typeof x !== 'object' || x.v !== MEMORY_VERSION || x.kind !== 'line-memory') fail('A memory export', 'be {v: 1, kind: "line-memory", steps}');
  if (!x.steps || typeof x.steps !== 'object' || Array.isArray(x.steps)) fail("A memory export's steps", 'be an object of step -> records');
  for (const [step, recs] of Object.entries(x.steps)) {
    if (!STEP_ID.test(step)) fail(`The memory export's step ${step}`, 'be a step id');
    if (!Array.isArray(recs)) fail(`The memory export's ${step}`, 'be a list of records');
    recs.forEach((r) => { assertMemoryRecord(r); if (r.step !== step) fail(`Memory record ${r.id}`, `belong to ${step}`); });
  }
}

/** Plan feedback (planService and the Import agent's edits) -> the memory outcome kind. */
export const PLAN_EVENT_KIND = Object.freeze({ approve: 'approved', 'approve-all': 'approved', skip: 'skipped', move: 'reordered', edit: 'edited', refusal: 'refused', 'fix-picked': 'fix-picked' });

/**
 * Who did it, as memory says it ('ui' is a person in Cockpit; anything else is an agent; 'line' is Line itself).
 * @param {string} by
 * @returns {'person'|'agent'|'line'}
 */
export const memoryBy = (by) => (by === 'ui' || by === 'owner' || by === 'person' ? 'person' : by === 'line' ? 'line' : 'agent');
