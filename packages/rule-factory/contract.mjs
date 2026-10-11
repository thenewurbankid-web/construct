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
