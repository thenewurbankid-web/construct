// cs2 -- the static rule factory's contract. Static code stays the runtime; this collects where it missed so new static
// rules can be proposed offline (reviewed, never inside Line at runtime) and kept only when they raise held-out
// accuracy with no regressions. The key number is the share of decisions static code made, per step.
//
//   MissRecord     one decision Line made (or could not make), from one source, with who made it and whether static
//                  code got it right. `options` are the closed options the decision had (empty when it had none),
//                  `kind` says how a wrong answer was wrong (absent: the right one was not offered; picked: it was,
//                  and another was chosen), `correct` is the right option once known. `label` is jev's verdict on the
//                  static choice (null until labelled).
//   StaticShare    per step: how many decisions, how many static code made, the share, one sentence.
//   LabelItem      one closed question about a miss: which option was right, plus "none fits". jev answers it; with
//                  jev down the rules answer it and say so; a person or Claude can answer it offline (JSONL).
//                  Its core is the step-miss shape {step, kind, options, chosen, correct} (branch im1-im2).
//   RuleProposal   a candidate static rule made from labelled misses: data (a lexicon or fix-ranking change), its own
//                  test case, the misses it came from, one sentence. Never applied by itself.
//   GateResult     one proposal measured on the held-out evals (Train Line's held-out worlds, the drafter's eval):
//                  ships only when a held-out score rises, no case that passed now fails, and its own test passes.
//
// Sources: plan feedback (line/plans/*.json), validate findings, decision traces (decision-trace.v1, the state
// directory), the reason ledger (@mx/reason's file ledger, <dir>/<pairId>/<requestId>.json) and the drafter's misses on
// Train Line's train split. No model is called here; jev is called only through Line's one decide() (label.mjs).

export const MISS_SOURCES = Object.freeze(['plan', 'validate', 'decision-trace', 'reason-ledger', 'drafter']);
/** Sources with a collector (all of them since cs2). */
export const COLLECTED_SOURCES = MISS_SOURCES;
export const DECIDERS = Object.freeze(['static', 'person', 'agent', 'model', 'none']);
/** How a wrong answer was wrong (the step-miss shape of branch im1-im2). */
export const MISS_KINDS = Object.freeze(['absent', 'picked']);
/** The closed option every label item has last: none of the offered options fits. */
export const NONE_FITS = 'none';
/** Who answered a label item. */
export const LABELLERS = Object.freeze(['jev', 'rules', 'person', 'claude']);
/** The kinds of static rule a proposal can be, and the file each one changes. */
export const PROPOSAL_KINDS = Object.freeze({
  verb: 'lexicon', grammar: 'lexicon', handler: 'lexicon', catalog: 'lexicon', 'fix-rank': 'fix-ranking',
});
/** The rule files a proposal changes, relative to the Construct checkout (applied only through the writer). */
export const RULE_FILES = Object.freeze({
  lexicon: 'packages/engine/line/drafter/lexicon.json',
  'fix-ranking': 'packages/engine/line/fix-ranking.json',
});
/** Where the factory keeps its work in a project's Line state folder. */
export const FACTORY_FILES = Object.freeze({
  proposals: 'line/rules/proposals.json',
  labelling: 'line/rules/labelling.jsonl',
  gate: 'line/rules/gate.json',
});

/**
 * @typedef {'plan'|'validate'|'decision-trace'|'reason-ledger'|'drafter'} MissSource
 * @typedef {'static'|'person'|'agent'|'model'|'none'} Decider  `none`: nobody has decided yet (open, or failed).
 *
 * @typedef {object} MissRecord
 * @property {string} id                 Stable: the same input gives the same id.
 * @property {MissSource} source
 * @property {string} step               The step the decision belongs to: a plan tool ("line.baseOn"), a fix choice
 *                                       ("line.baseOn fix choice"), a validate rule ("validate LINE-DIR"), a chooser
 *                                       id, a reason step ("gatelm.gapFill") or "drafter <intent>".
 * @property {Decider} decidedBy
 * @property {boolean} miss              Static code did not make the final decision (or made a different one).
 * @property {string|null} staticChoice  What static code chose or recommended (a fix id, "pass"), null when it had none.
 * @property {string|null} finalChoice   What was finally chosen, null while open.
 * @property {string} sentence           Plain English: what happened.
 * @property {{file: string, planId?: string, stepId?: string, rule?: string, line?: number, chooser?: string, pairId?: string, requestId?: string, caseId?: string}} ref
 * @property {null|'right'|'wrong'} label  jev's label of the static choice, null until labelled.
 * @property {string[]} [options]        The closed options of the decision (absent or empty: none to label).
 * @property {null|'absent'|'picked'} [kind]  How a known-wrong answer was wrong; null when not known to be wrong.
 * @property {string|null} [correct]     The right option once known (NONE_FITS when none of the options fits).
 * @property {{request?: string, words?: string[], intent?: string, rule?: string, question?: string}} [context]
 *                                       What a labeller reads (no project names: slots only).
 *
 * @typedef {{step: string, total: number, byStatic: number, share: number, sentence: string}} StaticShare
 *
 * @typedef {object} LabelItem
 * @property {string} id                 Stable: the miss id (plus the word, for a drafter word).
 * @property {string} missId
 * @property {MissSource} source
 * @property {string} step
 * @property {null|'absent'|'picked'} kind
 * @property {string} question           One plain-English question.
 * @property {string[]} options          Closed option ids, NONE_FITS last.
 * @property {string|null} chosen        What Line chose (static or a model), null when it chose nothing.
 * @property {string|null} correct       The label: one of `options`, null until labelled.
 * @property {null|'jev'|'rules'|'person'|'claude'} labelledBy
 * @property {string|null} rulesSaid     What the rules would answer (null: the rules cannot tell), kept for agreement.
 * @property {string[]} facts            Short facts a labeller reads.
 * @property {{word?: string, caseId?: string, rule?: string, intent?: string}} about
 *
 * @typedef {object} RuleProposal
 * @property {string} id                 Stable: a hash of the kind and the change.
 * @property {keyof typeof PROPOSAL_KINDS} kind
 * @property {'lexicon'|'fix-ranking'} target
 * @property {any} change                The data merged into the rule file (lexicon: a mergeLexicon addition; fix-ranking: {rule, prefer, over}).
 * @property {string[]} evidence         Label item ids it came from.
 * @property {{kind: 'train-cases', caseIds: string[]}|{kind: 'fix-items', items: {id: string, options: string[], chosen: string|null, correct: string, heldOut: boolean}[]}} test
 * @property {string} sentence
 *
 * @typedef {{recall: number|null, precision: number|null, preferred: number|null, n: number}} HeldOutScore
 * @typedef {{train: HeldOutScore, drafter: HeldOutScore}} GateScores
 *
 * @typedef {object} GateResult
 * @property {string} proposalId
 * @property {boolean} pass
 * @property {GateScores} with
 * @property {string[]} improved         The held-out scores that rose ("train preferred", "drafter recall", ...).
 * @property {string[]} regressions      Case ids that passed before and fail with the proposal (any split).
 * @property {{ok: boolean, sentence: string}} ownTest
 * @property {string} sentence
 *
 * @typedef {{at: string, baseline: GateScores, results: GateResult[], together: {ids: string[], with: GateScores, regressions: string[], ok: boolean}|null, passed: string[], sentence: string}} GateReport
 */

/** @param {unknown} c @param {string} msg @param {string} [what] */
function must(c, msg, what = 'MissRecord') {
  if (!c) throw new TypeError(`${what} contract: ${msg}`);
}
const FULL_SENTENCE = /^[A-Z0-9"].*[.?!]$/s;

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
  must(typeof r.sentence === 'string' && FULL_SENTENCE.test(r.sentence), 'sentence is a full sentence');
  must(r.ref && typeof r.ref.file === 'string', 'ref names a file');
  must(r.label === null || r.label === 'right' || r.label === 'wrong', 'label is null, right or wrong');
  must(r.options === undefined || (Array.isArray(r.options) && r.options.every((o) => typeof o === 'string' && o)), 'options is a list of option ids');
  must(r.kind === undefined || r.kind === null || MISS_KINDS.includes(r.kind), 'kind is absent, picked or null');
  must(r.correct === undefined || r.correct === null || typeof r.correct === 'string', 'correct is a string or null');
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
 * @param {any} i
 * @returns {LabelItem}
 */
export function assertLabelItem(i) {
  const m = (c, msg) => must(c, msg, 'LabelItem');
  m(i && typeof i.id === 'string' && i.id, 'an item has an id');
  m(typeof i.missId === 'string' && i.missId, 'an item names its miss');
  m(MISS_SOURCES.includes(i.source), 'source is a miss source');
  m(typeof i.step === 'string' && i.step, 'an item names its step');
  m(i.kind === null || MISS_KINDS.includes(i.kind), 'kind is absent, picked or null');
  m(typeof i.question === 'string' && /\?$/.test(i.question), 'question is one question');
  m(Array.isArray(i.options) && i.options.length >= 2 && i.options.at(-1) === NONE_FITS && new Set(i.options).size === i.options.length, `options are distinct closed ids with "${NONE_FITS}" last`);
  m(i.chosen === null || typeof i.chosen === 'string', 'chosen is a string or null');
  m(i.correct === null || i.options.includes(i.correct), 'correct is null or one of the options');
  m(i.labelledBy === null || LABELLERS.includes(i.labelledBy), `labelledBy is null or one of ${LABELLERS.join(', ')}`);
  m((i.correct === null) === (i.labelledBy === null), 'an item is labelled exactly when it says who labelled it');
  m(i.rulesSaid === null || i.options.includes(i.rulesSaid), 'rulesSaid is null or one of the options');
  m(Array.isArray(i.facts) && i.facts.every((f) => typeof f === 'string'), 'facts are strings');
  return i;
}

/**
 * The step-miss shape of branch im1-im2: {step, kind, options, chosen, correct}.
 * @param {LabelItem} i
 * @returns {{step: string, kind: null|'absent'|'picked', options: string[], chosen: string|null, correct: string|null}}
 */
export function toStepMiss(i) {
  return { step: i.step, kind: i.kind, options: i.options.filter((o) => o !== NONE_FITS), chosen: i.chosen, correct: i.correct === NONE_FITS ? null : i.correct };
}

/**
 * @param {any} p
 * @returns {RuleProposal}
 */
export function assertRuleProposal(p) {
  const m = (c, msg) => must(c, msg, 'RuleProposal');
  m(p && typeof p.id === 'string' && /^rp-[0-9a-f]{12}$/.test(p.id), 'a proposal has an id rp-<12 hex>');
  m(Object.keys(PROPOSAL_KINDS).includes(p.kind), `kind is one of ${Object.keys(PROPOSAL_KINDS).join(', ')}`);
  m(p.target === PROPOSAL_KINDS[p.kind], 'target is the rule file of its kind');
  m(p.change && typeof p.change === 'object', 'a proposal carries its change as data');
  m(Array.isArray(p.evidence) && p.evidence.length >= 1, 'a proposal names the misses it came from');
  m(p.test && ((p.test.kind === 'train-cases' && Array.isArray(p.test.caseIds) && p.test.caseIds.length >= 1) || (p.test.kind === 'fix-items' && Array.isArray(p.test.items) && p.test.items.length >= 1)), 'a proposal carries its own test case');
  m(typeof p.sentence === 'string' && FULL_SENTENCE.test(p.sentence), 'sentence is a full sentence');
  return p;
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

/**
 * @param {any} r
 * @returns {GateReport}
 */
export function assertGateReport(r) {
  const m = (c, msg) => must(c, msg, 'GateReport');
  const score = (s) => s && ['train', 'drafter'].every((k) => s[k] && Number.isInteger(s[k].n));
  m(r && typeof r.at === 'string', 'a report has a time');
  m(score(r.baseline), 'a report has the baseline scores');
  m(Array.isArray(r.results), 'a report lists its results');
  for (const x of r.results) {
    m(typeof x.proposalId === 'string' && typeof x.pass === 'boolean' && score(x.with), 'each result names its proposal, pass and scores');
    m(Array.isArray(x.improved) && Array.isArray(x.regressions) && x.ownTest && typeof x.ownTest.ok === 'boolean', 'each result lists what improved, what regressed and its own test');
    m(!x.pass || (x.improved.length > 0 && x.regressions.length === 0 && x.ownTest.ok), 'a result passes only when a held-out score rose, nothing regressed and its own test passed');
    m(typeof x.sentence === 'string' && FULL_SENTENCE.test(x.sentence), 'each result has a sentence');
  }
  m(Array.isArray(r.passed) && r.passed.every((id) => r.results.some((x) => x.proposalId === id && x.pass)), 'passed lists exactly results that passed');
  m(typeof r.sentence === 'string' && FULL_SENTENCE.test(r.sentence), 'a report has a sentence');
  return r;
}
