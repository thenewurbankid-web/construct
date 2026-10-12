// cs2 (scaffold) -- the static rule factory's contract. Static code stays the runtime; this collects where it missed
// so rules can be proposed at development time (as reviewed PRs, never inside Line) and kept only when they raise
// held-out accuracy with no regressions. The key number is the share of decisions static code made, per step.
//
//   MissRecord     one decision Line made (or could not make), from one source, with who made it and whether static
//                  code got it right. `label` is for jev to fill when it labels the corpus (null until then).
//   StaticShare    per step: how many decisions, how many static code made, the share, one sentence.
//
// Sources: plan feedback (line/plans/*.json) and validate findings are collected now (collect.mjs). Decision traces
// and the reason ledger are in the contract but have no collector yet (scaffold). No model is called anywhere here.

export const MISS_SOURCES = Object.freeze(['plan', 'validate', 'decision-trace', 'reason-ledger']);
/** Sources with a collector today. */
export const COLLECTED_SOURCES = Object.freeze(['plan', 'validate']);
export const DECIDERS = Object.freeze(['static', 'person', 'agent', 'model', 'none']);

/**
 * @typedef {'plan'|'validate'|'decision-trace'|'reason-ledger'} MissSource
 * @typedef {'static'|'person'|'agent'|'model'|'none'} Decider  `none`: nobody has decided yet (open, or failed).
 *
 * @typedef {object} MissRecord
 * @property {string} id                 Stable: the same input gives the same id.
 * @property {MissSource} source
 * @property {string} step               The step the decision belongs to: a plan tool ("line.baseOn"), a fix choice
 *                                       ("line.baseOn fix choice") or a validate rule ("validate LINE-DIR").
 * @property {Decider} decidedBy
 * @property {boolean} miss              Static code did not make the final decision (or made a different one).
 * @property {string|null} staticChoice  What static code chose or recommended (a fix id, "pass"), null when it had none.
 * @property {string|null} finalChoice   What was finally chosen, null while open.
 * @property {string} sentence           Plain English: what happened.
 * @property {{file: string, planId?: string, stepId?: string, rule?: string, line?: number}} ref
 * @property {null|'right'|'wrong'} label  jev's label of the static choice, null until labelled.
 *
 * @typedef {{step: string, total: number, byStatic: number, share: number, sentence: string}} StaticShare
 */

/** @param {unknown} c @param {string} msg */
function must(c, msg) {
  if (!c) throw new TypeError(`MissRecord contract: ${msg}`);
}

/**
 * @param {any} r
 * @returns {MissRecord}
 */
export function assertMissRecord(r) {
  must(r && typeof r === 'object', 'a record is an object');
  must(typeof r.id === 'string' && r.id, 'a record has an id');
  must(MISS_SOURCES.includes(r.source), `source is one of ${MISS_SOURCES.join(', ')}`);
  must(typeof r.step === 'string' && r.step, 'a record names its step');
  must(DECIDERS.includes(r.decidedBy), `decidedBy is one of ${DECIDERS.join(', ')}`);
  must(typeof r.miss === 'boolean', 'miss is true or false');
  must(r.miss || r.decidedBy === 'static', 'a record that is not a miss was decided by static code');
  must(r.staticChoice === null || typeof r.staticChoice === 'string', 'staticChoice is a string or null');
  must(r.finalChoice === null || typeof r.finalChoice === 'string', 'finalChoice is a string or null');
  must(typeof r.sentence === 'string' && /^[A-Z0-9"].*[.?!]$/.test(r.sentence), 'sentence is a full sentence');
  must(r.ref && typeof r.ref.file === 'string', 'ref names a file');
  must(r.label === null || r.label === 'right' || r.label === 'wrong', 'label is null, right or wrong');
  return r;
}

/**
 * @param {any} s
 * @returns {StaticShare}
 */
export function assertStaticShare(s) {
  if (!(s && typeof s.step === 'string' && Number.isInteger(s.total) && Number.isInteger(s.byStatic) && s.byStatic <= s.total && s.share >= 0 && s.share <= 1 && typeof s.sentence === 'string')) {
    throw new TypeError('StaticShare contract: step, total >= byStatic, share between 0 and 1, and a sentence');
  }
  return s;
}

// ------------------------------------------------------------------------------------------------- im1: miss reports
// A miss is classified by WHERE the right answer was (im1):
//   absent   the right answer was not among the options Line offered (static, Qwen or jev could not have picked it):
//            a static tool, template, typed fix or catalog entry is missing. These become new static tools.
//   picked   the right answer was among the options, but the decider (static order, Qwen or jev) chose another one:
//            a ranking problem, for jev and the ranker, not for a new tool.
// The right answer comes from the person (a fix they applied, an edit, a choice in plan feedback), from Train Line's
// gold routes, or from the drafter eval's gold. Every field is slotted: tools, rule ids, fix ids and request shapes
// with slot kinds (`<feature>`, `<component>`), never a project or domain word.

export const MISS_KINDS = Object.freeze(['absent', 'picked']);
export const CLASSIFIED_SOURCES = Object.freeze(['plan', 'train', 'drafter-eval']);
export const CORRECT_FROM = Object.freeze(['person', 'train-gold', 'drafter-eval']);

/**
 * @typedef {'absent'|'picked'} MissKind
 * @typedef {object} ClassifiedMiss
 * @property {string} id                 Stable: source plus the case or plan step.
 * @property {'plan'|'train'|'drafter-eval'} source
 * @property {string} step               The plan step (tool) the right answer belongs to, e.g. "line.promote"; "ask" or
 *                                       "refuse" when the right answer is a question or a refusal.
 * @property {MissKind} kind
 * @property {string[]} options          What Line offered, as slotted signatures (tool chains, fix ids).
 * @property {string|null} chosen        What Line chose (recommended), null when it chose nothing.
 * @property {string} correct            The right answer, as a slotted signature.
 * @property {'person'|'train-gold'|'drafter-eval'} correctFrom
 * @property {string} pattern            "<request shape> -> <correct>", slot kinds only; groups misses for the report.
 * @property {string} sentence           Plain English: what was missed.
 *
 * @typedef {{step: string, absent: number, picked: number, total: number, sentence: string}} MissStepRow
 * @typedef {{pattern: string, step: string, count: number, sources: string[], examples: string[], sentence: string}} AbsentPattern
 * @typedef {object} MissReport
 * @property {{misses: number, absent: number, picked: number}} total
 * @property {MissStepRow[]} steps        Per step, most misses first.
 * @property {AbsentPattern[]} topAbsent  The most common absent patterns (what a new static tool should cover).
 * @property {string} sentence
 */

/** Text outside slots, with Line's own ids (tools, rule/fix ids) taken out: what must hold no domain word. */
const outsideSlots = (s) => String(s).replace(/<[^>]*>/g, ' ').replace(/\b(line|construct)\.[a-zA-Z.]+/g, ' ').replace(/\b[A-Z]+(-[A-Z0-9]+)+(\/[a-zA-Z-]+)?/g, ' ');
/**
 * Whether a string is slotted: outside `<slots>` (and Line's own tool, rule and fix ids) it holds no quoted text and no
 * identifier-shaped word (PascalCase or camelCase), which is how a project name would show.
 * @param {string} s
 * @returns {boolean}
 */
export function domainFree(s) {
  const t = outsideSlots(s);
  return !/"[^"]*"|`[^`]*`/.test(t) && !/\b[A-Z][a-z0-9]+[A-Z]\w*|\b[a-z]+[A-Z]\w*/.test(t);
}

/**
 * @param {any} m
 * @returns {ClassifiedMiss}
 */
export function assertClassifiedMiss(m) {
  must(m && typeof m === 'object', 'a classified miss is an object');
  must(typeof m.id === 'string' && m.id, 'a classified miss has an id');
  must(CLASSIFIED_SOURCES.includes(m.source), `source is one of ${CLASSIFIED_SOURCES.join(', ')}`);
  must(typeof m.step === 'string' && m.step, 'a classified miss names its step');
  must(MISS_KINDS.includes(m.kind), 'kind is absent or picked');
  must(Array.isArray(m.options) && m.options.every((o) => typeof o === 'string'), 'options are slotted strings');
  must(m.chosen === null || typeof m.chosen === 'string', 'chosen is a string or null');
  must(typeof m.correct === 'string' && m.correct, 'a classified miss names the right answer');
  must(m.chosen !== m.correct, 'a miss chose something other than the right answer');
  must((m.kind === 'picked') === m.options.includes(m.correct), 'picked exactly when the right answer was among the options');
  must(CORRECT_FROM.includes(m.correctFrom), `correctFrom is one of ${CORRECT_FROM.join(', ')}`);
  must(typeof m.pattern === 'string' && m.pattern.includes(' -> '), 'pattern is "<shape> -> <correct>"');
  for (const s of [m.pattern, m.correct, ...m.options]) must(domainFree(s), `"${s}" holds no domain word`);
  must(typeof m.sentence === 'string' && /^[A-Z0-9"].*[.?!]$/.test(m.sentence), 'sentence is a full sentence');
  return m;
}

/**
 * @param {any} r
 * @returns {MissReport}
 */
export function assertMissReport(r) {
  must(r && r.total && Number.isInteger(r.total.misses) && r.total.misses === r.total.absent + r.total.picked, 'total misses = absent + picked');
  must(Array.isArray(r.steps) && r.steps.every((s) => typeof s.step === 'string' && s.total === s.absent + s.picked && typeof s.sentence === 'string'), 'each step row adds up');
  must(r.steps.reduce((a, s) => a + s.total, 0) === r.total.misses, 'the step rows add up to the total');
  must(Array.isArray(r.topAbsent) && r.topAbsent.every((p) => domainFree(p.pattern) && Number.isInteger(p.count) && p.count > 0), 'top absent patterns are slotted with a count');
  must(typeof r.sentence === 'string' && /^[A-Z0-9].*[.?!]$/.test(r.sentence), 'the report has a sentence');
  return r;
}
