// cs1 -- checkSentence: the rule set every user-facing sentence passes (contract.mjs SENTENCE_RULES). Pure.

/** Known slot names and how a person says them. Anything else camelCase is split into words. */
export const SLOT_WORDS = Object.freeze({
  libraryId: 'library item',
  stepId: 'step',
  fixOf: 'the step it fixes',
  fixId: 'fix',
  sessionId: 'session',
  planId: 'plan',
  featureName: 'feature',
  pageId: 'page',
  componentId: 'component',
  propName: 'prop',
  exitCode: 'exit code',
});

/** Plan tools and how a person says them. */
export const TOOL_WORDS = Object.freeze({
  'line.baseOn': 'Base on',
  'line.promote': 'Promote',
  'line.setPageProp': 'Set a page prop',
  'line.fix': 'Apply a fix',
  'line.setFragment': 'Edit code',
  'line.setBase': 'Change the base',
  'line.moveFile': 'Move a file',
  'line.createLayout': 'Create the layout',
  'line.leaveAsIs': 'Leave as it is',
  'line.project': 'Read the project',
});

/** "libraryId" -> "library id" (to-english's camelToWords). */
export const camelToWords = (name) => String(name).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();

/** A slot name as a person says it. */
export const slotWords = (name) => SLOT_WORDS[name] ?? camelToWords(name).replace(/_/g, ' ');

/** Raw ids a sentence may not name (each a global regex so the summarizer can lift them out). */
export const ID_PATTERNS = Object.freeze([
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/g, // uuid
  /\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g, // a hash
  /\b(?:line|construct|plan|mx)\.[a-z][A-Za-z]+\b/g, // a tool name
  /\b[A-Z][A-Z0-9]{1,}-(?:\d{2,}|[A-Z]{2,})\b/g, // a rule id (LINE-DIR, PAGE-008)
  /\b(?:step|ses|plan|fix|run|req|msg)[-_:](?!by-|up\b)[A-Za-z0-9][\w:-]*/g, // a prefixed id (step-3, ses-cockpit, fix:LINE-DIR)
  /\bs\d+\.p\d+\b/g, // a spec point id
  /[^\s|]+\|[^\s|]+\|\d+/g, // a finding key rule|file|line
]);

/** A word that is a path or a file name (allowed: people know their files). */
const isPathish = (w) => w.includes('/') || /\.[a-z]{1,5}$/i.test(w.replace(/[.,;:!?)"']+$/, ''));
const SLOTISH = /^[a-z]+(?:[A-Z][a-z0-9]*)+$|^[a-z]+(?:_[a-z0-9]+)+$/;

/**
 * The slot-like words of a sentence (camelCase or snake_case, outside paths).
 * @param {string} s
 * @returns {string[]}
 */
export function slotTokens(s) {
  // A quoted word is a name the sentence quotes on purpose ("useLinePages"), not a slot.
  return String(s).split(/\s+/).filter((w) => !isPathish(w) && !/^\(?["'`]/.test(w)).map((w) => w.replace(/^[("'`]+|[.,;:!?)"'`]+$/g, '')).filter((w) => SLOTISH.test(w));
}

/**
 * The raw ids in a sentence.
 * @param {string} s
 * @returns {string[]}
 */
export function rawIds(s) {
  const out = [];
  for (const re of ID_PATTERNS) for (const m of String(s).matchAll(new RegExp(re.source, re.flags))) out.push(m[0]);
  return [...new Set(out)];
}

const FULL = /^["'(]?[A-Z0-9][\s\S]*[.?!]["')]?$/;

/**
 * Does one sentence pass the rules? `names` are item and feature names as the person wrote them: they are names,
 * not slots (orderCheckout), and a sentence may start with one (orders has 1 page.).
 * @param {string} sentence
 * @param {{names?: string[]}} [options]
 * @returns {import('./contract.mjs').SentenceCheck}
 */
export function checkSentence(sentence, { names = [] } = {}) {
  /** @type {import('./contract.mjs').SentenceProblem[]} */
  const problems = [];
  const s = String(sentence ?? '').trim();
  // A sentence may start with the name of an item or a feature as the person wrote it ("orders has 1 page.").
  const named = names.find((n) => s.startsWith(n) && /^[\s,:;'"]/.test(s.slice(n.length)));
  const lead = named ? `X${s.slice(named.length)}` : s;
  if (!FULL.test(lead) || s.split(/\s+/).length < 2) problems.push({ rule: 'SENT-FULL', sentence: 'It is not a full sentence: start with a capital letter, use at least two words and end with a full stop.' });
  const ids = rawIds(s);
  if (ids.length) problems.push({ rule: 'SENT-ID', sentence: `It names ${ids.length === 1 ? 'a raw id' : 'raw ids'} (${ids.join(', ')}); move ${ids.length === 1 ? 'it' : 'them'} under Details.` });
  const slots = slotTokens(s).filter((w) => !names.includes(w));
  if (slots.length) problems.push({ rule: 'SENT-SLOT', sentence: `It uses slot names (${slots.join(', ')}); write them as words, for example "${slotWords(slots[0])}".` });
  return { ok: problems.length === 0, problems };
}
