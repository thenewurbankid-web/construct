// cs1 -- the summarizer contract: the one place Line makes and checks the text a person reads.
//
//   summarize(input) -> Summary   pure, no model, no fs (runs in the browser too). `sentences` are plain English and
//                                 each one passes checkSentence; `details` hold the technical part (tool call, code,
//                                 ids, options with confidence, the reasoning) that Cockpit shows in a collapsed
//                                 Details under the sentences (<PlainFirst>, ui/client/lib/PlainFirst.tsx).
//   checkSentence(s) -> SentenceCheck   the rule set: a full sentence, no raw ids, slot names as words.
//
// Built on Smith (~/Desktop/smith: Chain's connector words and, but, also, if, then, is; Organism.will()) and
// atomic-codemod's to-english step, both linked through packages/line-links (smith.json, atomic-codemod.json): code
// written as Smith chains reads as English, so the summarizer turns it into sentences with no model (links.mjs
// summarizeCode). GateLM's own model input stays free of English: nothing here feeds a model.

/** What a summary can be made from. */
export const SUMMARY_KINDS = Object.freeze(['plan-step', 'finding', 'feature', 'status', 'message', 'code']);

/** Who a `message` comes from. */
export const MESSAGE_SOURCES = Object.freeze(['oracle', 'trace', 'gatelm', 'reasoning', 'line']);

/** Smith's connector words (Chain: and, but, also, if, then, is; Organism: will). links.mjs checks them against the linked Smith. */
export const SMITH_CONNECTORS = Object.freeze(['and', 'but', 'also', 'if', 'then', 'is', 'will']);

/**
 * The sentence rules, with stable ids (the ids belong in Details, never in a sentence).
 * @type {ReadonlyArray<{id: SentenceRuleId, sentence: string}>}
 */
export const SENTENCE_RULES = Object.freeze([
  { id: 'SENT-FULL', sentence: 'A sentence starts with a capital letter, has at least two words and ends with a full stop, a question mark or an exclamation mark.' },
  { id: 'SENT-ID', sentence: 'A sentence names no raw ids (step, session or plan ids, rule ids, hashes, tool names); they go under Details.' },
  { id: 'SENT-SLOT', sentence: 'A slot name is written as words, for example "library item" instead of libraryId.' },
]);

/**
 * @typedef {'SENT-FULL'|'SENT-ID'|'SENT-SLOT'} SentenceRuleId
 * @typedef {{rule: SentenceRuleId, sentence: string}} SentenceProblem  `sentence` says in plain English what is wrong.
 * @typedef {{ok: boolean, problems: SentenceProblem[]}} SentenceCheck
 *
 * The technical part, one labelled block each (label in words, text as raw as it needs to be).
 * @typedef {{label: string, text: string}} SummaryDetail
 *
 * @typedef {object} Summary
 * @property {string[]} sentences   At least one; each passes checkSentence.
 * @property {SummaryDetail[]} details
 * @property {'static'} via          Always static: no model makes user-facing text.
 *
 * An option a decision offered, as the technical part shows it.
 * @typedef {{id: string, sentence: string, confidence?: number, recommended?: boolean}} SummaryOption
 *
 * @typedef {{kind: 'plan-step', step: {id: string, n: number, tool: string, args?: Record<string, unknown>, state: string, sentence: string, result?: any}}} PlanStepInput
 * @typedef {{kind: 'finding', finding: {sentence: string, rule: string, severity?: string, file: string, line: number, key?: string, fixes?: {id: string, sentence: string, rank?: number}[]}}} FindingInput
 * @typedef {{kind: 'feature', name: string, sentences: string[], names?: string[]}} FeatureInput  `names`: item names, kept as written.
 * @typedef {{kind: 'status', text: string, details?: SummaryDetail[]}} StatusInput
 * @typedef {{kind: 'message', from: 'oracle'|'trace'|'gatelm'|'reasoning'|'line', text: string, details?: SummaryDetail[], options?: SummaryOption[], reasoning?: string}} MessageInput
 * to-english's output for one function (atomic-codemod toEnglish): a title and one English line per statement.
 * @typedef {{kind: 'code', english: {title: string|null, steps: {english: string, code: string}[]}, code?: string}} CodeInput
 * @typedef {PlanStepInput|FindingInput|FeatureInput|StatusInput|MessageInput|CodeInput} SummaryInput
 */

/** @param {unknown} c @param {string} msg */
function must(c, msg) {
  if (!c) throw new TypeError(`Summary contract: ${msg}`);
}

/**
 * Throws a TypeError naming the first broken rule of a Summary; returns it otherwise.
 * @param {any} s
 * @param {(sentence: string) => SentenceCheck} check  checkSentence (passed in so the contract stays dependency-free).
 * @returns {Summary}
 */
export function assertSummary(s, check) {
  must(s && typeof s === 'object', 'a summary is an object');
  must(Array.isArray(s.sentences) && s.sentences.length > 0, 'a summary has at least one sentence');
  for (const t of s.sentences) {
    must(typeof t === 'string', 'every sentence is a string');
    const r = check(t);
    must(r.ok, `"${t}" breaks ${r.problems.map((p) => p.rule).join(', ')}`);
  }
  must(Array.isArray(s.details), 'details is a list');
  for (const d of s.details) must(d && typeof d.label === 'string' && typeof d.text === 'string', 'every detail has a label and a text');
  must(s.via === 'static', 'a summary is made by static code (via "static")');
  return s;
}
