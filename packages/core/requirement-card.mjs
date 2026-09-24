// #640 (epic #616, builds on #576) -- a requirement sentence is PARSED like a compiler, not reasoned about. Nouns become data
// objects, states or UI parts; verbs become actions (read, write, interact, navigate); business adjectives ("safely",
// "instantly") become named checks. Every noun, verb and check carries the span of the sentence text it came from, and every
// word of the sentence is covered by a span, listed as an open question, or out of scope by a stop word: `validateCard` proves it.
//
//   parseRequirement(text, { lexicon })  text -> { card, open, errors }; deterministic, pure, no model, no network.
//   resolveOpen(card, answers)           closed-question answers -> a NEW card (unknown answers are typed errors).
//   cardSummary(card)                    the small fixed-size object a person, an LLM and a decision model all receive.
//   readBack(card)                       one plain-English line per noun, verb and check.
//   validateCard(card, { lexicon })      the schema `requirement-card.v1` plus the coverage proof, by named code.
//
// Only the wording step is fuzzy, and it is not done here: a word the lexicon does not know is never guessed, it becomes an open
// question of 2-5 options shaped like a chooser summary (chooser.mjs `chooserSummary`), so a decision provider can suggest an
// option and a person confirms. A model may only PROPOSE a card; `validateCard` is the gate it goes through.
// Imports only node:fs and node:url (to read the data file): nothing here can reach a network or a model.
// Data: requirement-lexicon.json. Decision record and worked example: docs/REQUIREMENT-CARD.md.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

/** The card schema version string carried by every card as `version`. */
export const CARD_VERSION = 'requirement-card.v1';

/** Sizes fixed so a summary is always small. `question`, `label` and `why` equal `CHOOSER_LIMITS` in chooser.mjs (a test keeps them in step). */
export const CARD_LIMITS = Object.freeze({ minOptions: 2, maxOptions: 5, question: 160, label: 60, why: 120, text: 160, items: 8, lines: 12, line: 140 });

/** The closed sets of the schema. */
export const NOUN_KINDS = Object.freeze(['entity', 'state', 'ui-part', 'external']);
export const VERB_KINDS = Object.freeze(['read', 'write', 'interact', 'navigate']);

/** Every rejection a card, a lexicon or an answer can produce, by name, so callers and tests match on a code, not on text. */
export const CARD_ERROR_CODES = Object.freeze({
  CARD_NOT_OBJECT: 'CARD_NOT_OBJECT',
  CARD_VERSION_INVALID: 'CARD_VERSION_INVALID',
  CARD_SOURCE_INVALID: 'CARD_SOURCE_INVALID',
  CARD_LIST_INVALID: 'CARD_LIST_INVALID',
  CARD_ITEM_NOT_OBJECT: 'CARD_ITEM_NOT_OBJECT',
  CARD_ID_INVALID: 'CARD_ID_INVALID',
  CARD_ID_DUPLICATE: 'CARD_ID_DUPLICATE',
  CARD_KIND_INVALID: 'CARD_KIND_INVALID',
  CARD_TEXT_INVALID: 'CARD_TEXT_INVALID',
  CARD_SPAN_INVALID: 'CARD_SPAN_INVALID',
  CARD_SPAN_TEXT_MISMATCH: 'CARD_SPAN_TEXT_MISMATCH',
  CARD_SPAN_OVERLAP: 'CARD_SPAN_OVERLAP',
  CARD_PROPERTIES_INVALID: 'CARD_PROPERTIES_INVALID',
  CARD_VERB_TARGET_UNKNOWN: 'CARD_VERB_TARGET_UNKNOWN',
  CARD_CHECK_UNKNOWN: 'CARD_CHECK_UNKNOWN',
  CARD_CHECK_FIELD_INVALID: 'CARD_CHECK_FIELD_INVALID',
  CARD_OPEN_INVALID: 'CARD_OPEN_INVALID',
  CARD_ANSWER_INVALID: 'CARD_ANSWER_INVALID',
  CARD_COVERAGE_UNCOVERED_WORD: 'CARD_COVERAGE_UNCOVERED_WORD',
  LEXICON_NOT_OBJECT: 'LEXICON_NOT_OBJECT',
  LEXICON_SHAPE: 'LEXICON_SHAPE',
  LEXICON_CHECK_UNKNOWN: 'LEXICON_CHECK_UNKNOWN',
  LEXICON_WORD_CLASH: 'LEXICON_WORD_CLASH',
  LEXICON_QUESTION_INVALID: 'LEXICON_QUESTION_INVALID',
  PARSE_TEXT_INVALID: 'PARSE_TEXT_INVALID',
  PARSE_LEXICON_INVALID: 'PARSE_LEXICON_INVALID',
  PARSE_ANSWER_INVALID: 'PARSE_ANSWER_INVALID',
  RESOLVE_CARD_INVALID: 'RESOLVE_CARD_INVALID',
  RESOLVE_ANSWERS_INVALID: 'RESOLVE_ANSWERS_INVALID',
  RESOLVE_UNKNOWN_OPEN: 'RESOLVE_UNKNOWN_OPEN',
  RESOLVE_UNKNOWN_OPTION: 'RESOLVE_UNKNOWN_OPTION',
  RESOLVE_RESULT_INVALID: 'RESOLVE_RESULT_INVALID',
});

/**
 * @typedef {{ code: string, path: string, message: string }} CardError
 *
 * @typedef {{ id: string, kind: 'entity'|'state'|'ui-part'|'external', text: string, properties?: string[], span: [number, number] }} CardNoun
 * A thing in the sentence: a data object, a state of the user, a part of the screen or an outside service.
 *
 * @typedef {{ id: string, kind: 'read'|'write'|'interact'|'navigate', text: string, on: string[], span: [number, number] }} CardVerb
 * An action, and the nouns it acts on (`on`, noun ids).
 *
 * @typedef {{ id: string, name: string, from: string, span: [number, number], why: string }} CardCheck
 * A business adjective kept as a named check (`from` is the adjective as written).
 *
 * @typedef {{ id: string, text: string, span: [number, number], slot: 'noun'|'verb', question: string }} CardOpen
 * A word the lexicon does not know: a closed question, never a guess.
 *
 * @typedef {{ open: string, text: string, span: [number, number], slot: 'noun'|'verb', option: string }} CardAnswer
 * An answered open question, kept on the card so a re-parse gives the same result.
 *
 * @typedef {{ version: string, source: { text: string }, nouns: CardNoun[], verbs: CardVerb[], checks: CardCheck[], open: CardOpen[], answers?: CardAnswer[] }} RequirementCard
 *
 * @typedef {{ id: string, question: string, options: { id: string, label: string, enabled: boolean, why: string }[], chosen: string | null }} OpenQuestion
 * The same shape as a chooser summary, so a decision provider can be asked to suggest an option.
 */

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.trim().length > 0;
const isStringArray = (v) => Array.isArray(v) && v.every(isNonEmptyString);
const ID_RE = /^[a-z][a-z0-9-]*$/;
const CHECK_NAME_RE = /^[a-z][a-z0-9-]*$/;
const WORD_RE = /[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*|[,;:]/g;
const SLOT_OPTIONS = Object.freeze({ noun: [...NOUN_KINDS, 'ignore'], verb: [...VERB_KINDS, 'ignore'] });
const VERB_SLOT_PREV = new Set(['to', 'can', 'could', 'will', 'must', 'should', 'may']);

// ---------------------------------------------------------------------------------------------------------------- lexicon

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
};

let cachedLexicon;

/**
 * The lexicon shipped in requirement-lexicon.json (data only), read once and deep-frozen.
 *
 * @returns {object} The frozen default lexicon.
 *
 * @example
 * defaultLexicon().verbs.read.includes('see'); // => true
 */
export function defaultLexicon() {
  cachedLexicon ??= deepFreeze(JSON.parse(fs.readFileSync(fileURLToPath(new URL('./requirement-lexicon.json', import.meta.url)), 'utf8')));
  return cachedLexicon;
}

/**
 * Validate a lexicon's shape without throwing: stop-word groups, the four verb kinds, the four noun kinds, modifiers, the
 * named checks, the adjective-to-check map (every check must exist) and the two open-question option sets (2-5 options).
 *
 * @param {any} lexicon The lexicon object.
 * @returns {{ valid: boolean, errors: CardError[] }} Every problem found, by code.
 *
 * @example
 * validateLexicon(defaultLexicon()).valid; // => true
 */
export function validateLexicon(lexicon) {
  const errors = [];
  const push = (code, path, message) => errors.push({ code: CARD_ERROR_CODES[code], path, message });
  if (!isPlainObject(lexicon)) {
    push('LEXICON_NOT_OBJECT', '', 'A lexicon must be an object.');
    return { valid: false, errors };
  }
  if (lexicon.version !== 1) push('LEXICON_SHAPE', 'version', '"version" must be 1.');
  const seen = new Map();
  const compatible = (a, b) => (a === 'verb' && b === 'ui-part') || (a === 'ui-part' && b === 'verb');
  const claim = (word, where, kind) => {
    const before = seen.get(word) ?? [];
    const clash = before.find((b) => !compatible(b.kind, kind));
    if (clash) push('LEXICON_WORD_CLASH', where, `"${word}" is already in ${clash.where}; one word has one meaning (only a UI part may also be a verb, like list).`);
    seen.set(word, [...before, { where, kind }]);
  };
  const words = (v, path) => {
    if (!Array.isArray(v) || !v.every((w) => isNonEmptyString(w) && w === w.toLowerCase() && !/\s/.test(w))) {
      push('LEXICON_SHAPE', path, 'Must be an array of lowercase single words.');
      return [];
    }
    return v;
  };
  const exactKeys = (obj, keys, path) => {
    if (!isPlainObject(obj) || Object.keys(obj).sort().join() !== [...keys].sort().join()) {
      push('LEXICON_SHAPE', path, `Must be an object with exactly the keys: ${keys.join(', ')}.`);
      return false;
    }
    return true;
  };

  const stopKeys = ['markers', 'determiners', 'actors', 'pronouns'];
  if (exactKeys(lexicon.stopWords, stopKeys, 'stopWords')) for (const g of stopKeys) for (const w of words(lexicon.stopWords[g], `stopWords.${g}`)) claim(w, `stopWords.${g}`, 'stop');
  if (exactKeys(lexicon.verbs, VERB_KINDS, 'verbs')) {
    for (const k of VERB_KINDS) for (const w of words(lexicon.verbs[k], `verbs.${k}`)) claim(w, `verbs.${k}`, 'verb');
  }
  if (exactKeys(lexicon.nouns, NOUN_KINDS, 'nouns')) {
    for (const k of NOUN_KINDS) {
      if (!isPlainObject(lexicon.nouns[k])) { push('LEXICON_SHAPE', `nouns.${k}`, 'Must be an object of phrase -> { properties? }.'); continue; }
      for (const [phrase, entry] of Object.entries(lexicon.nouns[k])) {
        if (phrase !== phrase.toLowerCase() || !phrase.trim()) push('LEXICON_SHAPE', `nouns.${k}.${phrase}`, 'A noun phrase must be lowercase and non-empty.');
        if (!isPlainObject(entry) || ('properties' in entry && !isStringArray(entry.properties))) push('LEXICON_SHAPE', `nouns.${k}.${phrase}`, 'An entry must be an object with optional "properties" (an array of names).');
        if (!phrase.includes(' ')) claim(phrase, `nouns.${k}`, k);
      }
    }
  }
  for (const w of words(lexicon.modifiers, 'modifiers')) claim(w, 'modifiers', 'modifier');
  if (!isPlainObject(lexicon.checks) || Object.keys(lexicon.checks).length === 0) push('LEXICON_SHAPE', 'checks', 'Must be an object of check name -> { why }.');
  else {
    for (const [name, entry] of Object.entries(lexicon.checks)) {
      if (!CHECK_NAME_RE.test(name) || !isPlainObject(entry) || !isNonEmptyString(entry.why)) push('LEXICON_SHAPE', `checks.${name}`, 'A check needs a kebab-case name and a non-empty "why".');
    }
  }
  if (!isPlainObject(lexicon.adjectives)) push('LEXICON_SHAPE', 'adjectives', 'Must be an object of adjective -> [check names].');
  else {
    for (const [word, names] of Object.entries(lexicon.adjectives)) {
      if (!Array.isArray(names) || names.length === 0) { push('LEXICON_SHAPE', `adjectives.${word}`, 'An adjective must map to at least one check.'); continue; }
      claim(word, 'adjectives', 'adjective');
      for (const name of names) if (!isPlainObject(lexicon.checks) || !(name in lexicon.checks)) push('LEXICON_CHECK_UNKNOWN', `adjectives.${word}`, `"${name}" is not a named check.`);
    }
  }
  if (!exactKeys(lexicon.questions, ['noun', 'verb'], 'questions')) return { valid: errors.length === 0, errors };
  for (const slot of ['noun', 'verb']) {
    const q = lexicon.questions[slot];
    const ids = Array.isArray(q?.options) ? q.options.map((o) => o?.id) : [];
    const ok = isNonEmptyString(q?.prompt) && q.prompt.includes('{text}')
      && ids.length >= CARD_LIMITS.minOptions && ids.length <= CARD_LIMITS.maxOptions
      && ids.join() === SLOT_OPTIONS[slot].join()
      && q.options.every((o) => isNonEmptyString(o.label) && isNonEmptyString(o.why));
    if (!ok) push('LEXICON_QUESTION_INVALID', `questions.${slot}`, `Needs a prompt containing {text} and the ${SLOT_OPTIONS[slot].length} options ${SLOT_OPTIONS[slot].join(', ')}, each with a label and a why.`);
  }
  return { valid: errors.length === 0, errors };
}

const indexes = new WeakMap();

/** Lookup tables for one lexicon, built once and cached (the lexicon is data, so the tables are too). */
function indexOf(lexicon) {
  let index = indexes.get(lexicon);
  if (index) return index;
  const stops = new Set(Object.values(lexicon.stopWords).flat());
  const verbs = new Map(VERB_KINDS.flatMap((k) => lexicon.verbs[k].map((w) => [w, k])));
  const nouns = new Map(NOUN_KINDS.flatMap((k) => Object.entries(lexicon.nouns[k]).map(([phrase, e]) => [phrase, { kind: k, properties: e.properties ?? [] }])));
  index = { stops, verbs, nouns, actors: new Set(lexicon.stopWords.actors), modifiers: new Set(lexicon.modifiers), adjectives: new Map(Object.entries(lexicon.adjectives)), checks: lexicon.checks };
  indexes.set(lexicon, index);
  return index;
}

// ---------------------------------------------------------------------------------------------------------------- tokens

/** Sentence ranges `[from, to)` of `text`: split after . ! ? and at a newline; ranges without a word are dropped. */
function sentenceRanges(text) {
  const ranges = [];
  let start = 0;
  const cut = /[.!?]+(?=\s|$)|\n+/g;
  for (let m = cut.exec(text); m; m = cut.exec(text)) {
    ranges.push([start, m.index]);
    start = m.index + m[0].length;
  }
  ranges.push([start, text.length]);
  return ranges.filter(([a, b]) => /[A-Za-z0-9]/.test(text.slice(a, b)));
}

/** Words (and the clause breaks , ; :) of `text` between `from` and `to`, with their offsets in the whole text. */
function tokensOf(text, from, to) {
  const tokens = [];
  const re = new RegExp(WORD_RE.source, 'g');
  const seg = text.slice(from, to);
  for (let m = re.exec(seg); m; m = re.exec(seg)) {
    const a = from + m.index;
    tokens.push({ text: m[0], low: m[0].toLowerCase(), from: a, to: a + m[0].length, brk: /^[,;:]$/.test(m[0]) });
  }
  return tokens;
}

/** Candidate base forms of an inflected verb: sees, clicking, saved, dragging, applies. */
function verbForms(low) {
  const out = [low];
  if (low.endsWith('ies')) out.push(`${low.slice(0, -3)}y`);
  if (low.endsWith('es')) out.push(low.slice(0, -2));
  if (low.endsWith('s')) out.push(low.slice(0, -1));
  for (const [suffix, cut] of [['ing', 3], ['ed', 2]]) {
    if (!low.endsWith(suffix) || low.length <= cut + 1) continue;
    const base = low.slice(0, -cut);
    out.push(base, `${base}e`);
    if (/([b-df-hj-np-tv-z])\1$/.test(base)) out.push(base.slice(0, -1));
  }
  if (low.endsWith('ed')) out.push(low.slice(0, -1));
  return out;
}

/** The verb kind of a word, through its inflections, or undefined. */
function verbKindOf(index, low) {
  for (const form of verbForms(low)) if (index.verbs.has(form)) return index.verbs.get(form);
  return undefined;
}

/** Singular candidates of a phrase whose last word may be a plural: products, categories, boxes. */
function phraseForms(words) {
  const last = words.at(-1);
  const head = words.slice(0, -1);
  const forms = [last];
  if (last.endsWith('ies')) forms.push(`${last.slice(0, -3)}y`);
  if (/(?:s|x|ch|sh)es$/.test(last)) forms.push(last.slice(0, -2));
  if (last.endsWith('s')) forms.push(last.slice(0, -1));
  return forms.map((w) => [...head, w].join(' '));
}

/** The longest noun phrase (up to three words) starting at token `i`, optionally limited to some kinds. */
function nounAt(index, tokens, i, kinds) {
  for (let n = Math.min(3, tokens.length - i); n >= 1; n--) {
    const slice = tokens.slice(i, i + n);
    if (slice.some((t) => t.brk)) continue;
    for (const form of phraseForms(slice.map((t) => t.low))) {
      const hit = index.nouns.get(form);
      if (hit && (!kinds || kinds.includes(hit.kind))) return { n, ...hit };
    }
  }
  return undefined;
}

// ---------------------------------------------------------------------------------------------------------------- parse

const keyOf = (from, to) => `${from}:${to}`;

/** Classify every token of one sentence into items: noun, verb, adj, stop, brk, ignored or unknown. */
function classify(tokens, index, decisions) {
  const items = [];
  const noun = (kind, from, to, properties) => items.push({ type: 'noun', kind, from, to, properties });
  for (let i = 0; i < tokens.length;) {
    const tok = tokens[i];
    const prev = tokens[i - 1]?.low;
    if (tok.brk) { items.push({ type: 'brk' }); i += 1; continue; }
    const decided = decisions.get(keyOf(tok.from, tok.to));
    if (decided) {
      if (decided.option === 'ignore') items.push({ type: 'ignored', from: tok.from, to: tok.to });
      else if (VERB_KINDS.includes(decided.option)) items.push({ type: 'verb', kind: decided.option, from: tok.from, to: tok.to });
      else noun(decided.option, tok.from, tok.to, []);
      i += 1;
      continue;
    }
    if (index.stops.has(tok.low)) { items.push({ type: 'stop', from: tok.from, to: tok.to }); i += 1; continue; }
    if (index.modifiers.has(tok.low)) {
      const hit = nounAt(index, tokens, i + 1, ['entity']);
      if (hit) { noun('entity', tok.from, tokens[i + hit.n].to, hit.properties); i += hit.n + 1; continue; }
    }
    const hit = nounAt(index, tokens, i);
    if (hit) {
      // A word that is both a noun and a verb (list) is a verb only where a verb must stand: after "to", "can", "will"...
      const alsoVerb = hit.n === 1 && verbKindOf(index, tok.low) !== undefined && VERB_SLOT_PREV.has(prev);
      if (!alsoVerb) {
        let to = tokens[i + hit.n - 1].to;
        let used = hit.n;
        if (hit.kind === 'state' && hit.n === 1 && index.actors.has(tokens[i + 1]?.low)) { to = tokens[i + 1].to; used = 2; }
        noun(hit.kind, tok.from, to, hit.properties);
        i += used;
        continue;
      }
    }
    if (index.adjectives.has(tok.low)) { items.push({ type: 'adj', from: tok.from, to: tok.to, names: index.adjectives.get(tok.low) }); i += 1; continue; }
    const kind = verbKindOf(index, tok.low);
    if (kind) { items.push({ type: 'verb', kind, from: tok.from, to: tok.to }); i += 1; continue; }
    items.push({ type: 'unknown', from: tok.from, to: tok.to, slot: VERB_SLOT_PREV.has(prev) ? 'verb' : 'noun' });
    i += 1;
  }
  return items;
}

/**
 * Which nouns each verb acts on. A verb acts on the nouns after it up to the next verb or comma, except a noun standing
 * directly before a verb (skipping adjectives), which belongs to that verb ("keyboard filtering"). A read or write verb with
 * nothing after it acts on the nearest earlier data object ("see it update": both act on the picture). States are never targets.
 */
function bindTargets(items) {
  const isTarget = (it) => it.type === 'noun' && it.kind !== 'state';
  const nextSolid = (k) => { let j = k + 1; while (items[j]?.type === 'adj') j += 1; return items[j]; };
  const claimedBy = new Map();
  items.forEach((it, k) => { if (isTarget(it) && nextSolid(k)?.type === 'verb') claimedBy.set(it, nextSolid(k)); });
  items.forEach((verb, k) => {
    if (verb.type !== 'verb') return;
    const on = [...claimedBy].filter(([, v]) => v === verb).map(([n]) => n);
    let following = 0;
    for (let j = k + 1; j < items.length && items[j].type !== 'verb' && items[j].type !== 'brk'; j++) {
      if (isTarget(items[j]) && !claimedBy.has(items[j])) { on.push(items[j]); following += 1; }
    }
    if (following === 0 && (verb.kind === 'read' || verb.kind === 'write')) {
      const earlier = items.slice(0, k).filter((it) => it.type === 'noun' && it.kind === 'entity' && !on.includes(it)).at(-1);
      if (earlier) on.push(earlier);
    }
    verb.targets = on;
  });
}

/** The fixed question text, options and slot for an open item, built from the lexicon's question data. */
function questionFor(lexicon, slot, text) {
  const data = lexicon.questions[slot];
  return { prompt: data.prompt.replace('{text}', text), options: data.options };
}

/**
 * Parse a requirement into a card, deterministically: the same text and lexicon always give the same card, byte for byte.
 * Sentences are split at . ! ? and newlines; each is read against the controlled-English templates ("When <trigger>, <actor>
 * can <verb> <noun>", "<actor> needs to <verb> <noun>", "<actor> can <verb> <noun> via <external>") as fixed marker words
 * (when, needs to, wants to, can, be able to, via) around the lexicon's verbs, nouns and adjectives. A word the lexicon does
 * not know becomes an open question, never a guess. `answers` re-applies earlier answers (see `resolveOpen`). Never throws.
 *
 * @param {string} text The requirement, one or more sentences.
 * @param {{ lexicon?: object, answers?: CardAnswer[] }} [options] The lexicon (default: requirement-lexicon.json) and recorded answers.
 * @returns {{ card: RequirementCard | null, open: OpenQuestion[], errors: CardError[] }} The card and its open questions as
 *   chooser-shaped summaries; `card` is null (with the reason in `errors`) only when the input itself is unusable.
 *
 * @example
 * const { card } = parseRequirement('A user can click a button.');
 * card.verbs[0].kind; // => 'interact'
 */
export function parseRequirement(text, options = {}) {
  const errors = [];
  const fail = (code, path, message) => ({ card: null, open: [], errors: [{ code: CARD_ERROR_CODES[code], path, message }, ...errors] });
  if (typeof text !== 'string' || !text.trim()) return fail('PARSE_TEXT_INVALID', 'text', 'The requirement must be a non-empty string.');
  const opts = isPlainObject(options) ? options : {};
  const lexicon = opts.lexicon ?? defaultLexicon();
  const lexCheck = validateLexicon(lexicon);
  if (!lexCheck.valid) return fail('PARSE_LEXICON_INVALID', 'lexicon', `The lexicon is not valid: ${lexCheck.errors.map((e) => `${e.code} at ${e.path}`).join('; ')}.`);
  const index = indexOf(lexicon);

  const recorded = Array.isArray(opts.answers) ? opts.answers : [];
  const decisions = new Map();
  const allTokens = sentenceRanges(text).flatMap(([a, b]) => tokensOf(text, a, b));
  for (const [i, a] of recorded.entries()) {
    const tok = isPlainObject(a) && Array.isArray(a.span) ? allTokens.find((t) => !t.brk && t.from === a.span[0] && t.to === a.span[1]) : undefined;
    if (!tok || !SLOT_OPTIONS[a.slot]?.includes(a.option)) return fail('PARSE_ANSWER_INVALID', `answers[${i}]`, 'A recorded answer must name one word of the text (span) and one option of its question.');
    decisions.set(keyOf(tok.from, tok.to), a);
  }

  const card = { version: CARD_VERSION, source: { text }, nouns: [], verbs: [], checks: [], open: [] };
  const counters = { n: 0, v: 0, c: 0, o: 0 };
  for (const [a, b] of sentenceRanges(text)) {
    const tokens = tokensOf(text, a, b);
    const items = classify(tokens, index, decisions);
    for (const it of items) {
      if (it.type === 'noun') {
        it.id = `n${++counters.n}`;
        const noun = { id: it.id, kind: it.kind, text: text.slice(it.from, it.to), ...(it.properties.length ? { properties: [...it.properties] } : {}), span: [it.from, it.to] };
        card.nouns.push(noun);
      } else if (it.type === 'verb') {
        it.id = `v${++counters.v}`;
      } else if (it.type === 'adj') {
        for (const name of it.names) {
          card.checks.push({ id: `c${++counters.c}`, name, from: text.slice(it.from, it.to), span: [it.from, it.to], why: index.checks[name].why });
        }
      } else if (it.type === 'unknown') {
        const word = text.slice(it.from, it.to);
        card.open.push({ id: `o${++counters.o}`, text: word, span: [it.from, it.to], slot: it.slot, question: questionFor(lexicon, it.slot, word).prompt });
      }
    }
    bindTargets(items);
    for (const it of items) {
      if (it.type === 'verb') card.verbs.push({ id: it.id, kind: it.kind, text: text.slice(it.from, it.to), on: it.targets.map((n) => n.id).sort((x, y) => Number(x.slice(1)) - Number(y.slice(1))), span: [it.from, it.to] });
    }
  }
  if (recorded.length) card.answers = [...recorded].map((a) => ({ open: a.open, text: a.text, span: [...a.span], slot: a.slot, option: a.option })).sort((x, y) => x.span[0] - y.span[0]);
  return { card, open: card.open.map((item) => openQuestion(card, item, lexicon)), errors: [] };
}

// ---------------------------------------------------------------------------------------------------------------- questions

const cap = (text, max) => {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

/**
 * The closed question for one open item: 2-5 options, capped text, in the shape of a chooser summary
 * (`{ id, question, options: [{ id, label, enabled, why }], chosen }`) so a person's screen, an LLM's tool result and a
 * decision provider (`suggest`) all read the same object. A noun-slot word offers entity, ui-part, state, external, ignore;
 * a verb-slot word offers read, write, interact, navigate, ignore. Options are lexicon data, never generated.
 *
 * @param {RequirementCard} card The card the item belongs to.
 * @param {CardOpen} item An entry of `card.open`.
 * @param {object} [lexicon] The lexicon (default: requirement-lexicon.json).
 * @returns {OpenQuestion} The question; `chosen` is the recorded answer or null.
 *
 * @example
 * openQuestion(card, card.open[0]).options.map((o) => o.id); // => ['entity', 'state', 'ui-part', 'external', 'ignore']
 */
export function openQuestion(card, item, lexicon = defaultLexicon()) {
  const { prompt, options } = questionFor(lexicon, item.slot, item.text);
  const answered = (card.answers ?? []).find((a) => a.open === item.id);
  return {
    id: item.id,
    question: cap(prompt, CARD_LIMITS.question),
    options: options.map((o) => ({ id: o.id, label: cap(o.label, CARD_LIMITS.label), enabled: true, why: cap(o.why, CARD_LIMITS.why) })),
    chosen: answered ? answered.option : null,
  };
}

/**
 * Apply answers to the open questions of a card and return a NEW card (the input is never changed). Each answer is
 * `{ [openId]: optionId }` with an option from that question (see `openQuestion`). The text is re-parsed with every
 * answer recorded on the card, so nouns, verb targets and ids come out exactly as if the word had been in the lexicon;
 * questions left unanswered stay open. Decision: the open questions are vocabulary choices, not plan flows, so they are
 * not built with `defineChooser` (its options must be PLAN_FLOWS flows) and are not compiled with `compileChain`; they
 * share its shape, its 2-5 option limit and its typed-error rule instead. User input never throws.
 *
 * @param {RequirementCard} card A card from `parseRequirement` or a previous `resolveOpen`.
 * @param {Record<string, string>} answers Open item id to option id.
 * @param {{ lexicon?: object }} [options] The lexicon, when the card was parsed with another one.
 * @returns {{ ok: true, card: RequirementCard, open: OpenQuestion[], errors: [] } | { ok: false, card: null, open: [], errors: CardError[] }}
 *   The new card and what is still open, or every problem found.
 *
 * @example
 * resolveOpen(card, { o1: 'entity' }).card.nouns.length;
 */
export function resolveOpen(card, answers, options = {}) {
  const lexicon = options.lexicon ?? defaultLexicon();
  const errors = [];
  const push = (code, path, message) => errors.push({ code: CARD_ERROR_CODES[code], path, message });
  const fail = () => ({ ok: false, card: null, open: [], errors });
  const checked = validateCard(card, { lexicon });
  if (!checked.valid) {
    for (const e of checked.errors) push('RESOLVE_CARD_INVALID', e.path, `${e.code}: ${e.message}`);
    return fail();
  }
  if (!isPlainObject(answers)) {
    push('RESOLVE_ANSWERS_INVALID', 'answers', 'answers must be an object { openId: optionId }.');
    return fail();
  }
  const fresh = [];
  for (const [id, option] of Object.entries(answers)) {
    const item = card.open.find((o) => o.id === id);
    if (!item) { push('RESOLVE_UNKNOWN_OPEN', `answers.${id}`, `No open question "${id}". Open: ${card.open.map((o) => o.id).join(', ') || 'none'}.`); continue; }
    const allowed = SLOT_OPTIONS[item.slot];
    if (typeof option !== 'string' || !allowed.includes(option)) { push('RESOLVE_UNKNOWN_OPTION', `answers.${id}`, `"${id}" has no option ${JSON.stringify(option)}. Options: ${allowed.join(', ')}.`); continue; }
    fresh.push({ open: id, text: item.text, span: [...item.span], slot: item.slot, option });
  }
  if (errors.length) return fail();
  const parsed = parseRequirement(card.source.text, { lexicon, answers: [...(card.answers ?? []), ...fresh] });
  if (!parsed.card) {
    for (const e of parsed.errors) push('RESOLVE_RESULT_INVALID', e.path, `${e.code}: ${e.message}`);
    return fail();
  }
  const after = validateCard(parsed.card, { lexicon });
  if (!after.valid) {
    for (const e of after.errors) push('RESOLVE_RESULT_INVALID', e.path, `${e.code}: ${e.message}`);
    return fail();
  }
  return { ok: true, card: parsed.card, open: parsed.open, errors: [] };
}

// ---------------------------------------------------------------------------------------------------------------- validate

const validSpan = (span, length) => Array.isArray(span) && span.length === 2 && Number.isInteger(span[0]) && Number.isInteger(span[1]) && span[0] >= 0 && span[0] < span[1] && span[1] <= length;

/**
 * Validate a card against `requirement-card.v1` without throwing, and prove coverage: every id unique, every kind in its closed
 * set, every span inside the text and equal to the word(s) it names, every verb target a real noun, every check a named check
 * of the lexicon, and every word of the sentence either inside a noun, verb, check or open span, marked out of scope by a stop
 * word (or by an answer "ignore"), or listed in `open`. A card a model proposed passes through here before a person sees it.
 *
 * @param {any} card The card to check.
 * @param {{ lexicon?: object }} [options] The lexicon (its stop words and check names); default: requirement-lexicon.json.
 * @returns {{ valid: boolean, errors: CardError[] }} Every problem found, by code.
 *
 * @example
 * validateCard({ version: 'requirement-card.v1', source: { text: 'Hello' }, nouns: [], verbs: [], checks: [], open: [] }).errors[0].code; // => 'CARD_COVERAGE_UNCOVERED_WORD'
 */
export function validateCard(card, options = {}) {
  const errors = [];
  const push = (code, path, message) => errors.push({ code: CARD_ERROR_CODES[code], path, message });
  if (!isPlainObject(card)) {
    push('CARD_NOT_OBJECT', '', 'A card must be an object { version, source, nouns, verbs, checks, open }.');
    return { valid: false, errors };
  }
  const lexicon = options.lexicon ?? defaultLexicon();
  if (!validateLexicon(lexicon).valid) {
    push('PARSE_LEXICON_INVALID', 'lexicon', 'The lexicon is not valid (see validateLexicon).');
    return { valid: false, errors };
  }
  const index = indexOf(lexicon);
  if (card.version !== CARD_VERSION) push('CARD_VERSION_INVALID', 'version', `"version" must be "${CARD_VERSION}".`);
  if (!isPlainObject(card.source) || typeof card.source.text !== 'string' || !card.source.text.trim()) {
    push('CARD_SOURCE_INVALID', 'source.text', '"source.text" must be the non-empty sentence text.');
    return { valid: false, errors };
  }
  const { text } = card.source;
  const lists = ['nouns', 'verbs', 'checks', 'open'];
  const listsOk = lists.filter((k) => {
    if (Array.isArray(card[k])) return true;
    push('CARD_LIST_INVALID', k, `"${k}" must be an array.`);
    return false;
  });
  if ('answers' in card && card.answers !== undefined && !Array.isArray(card.answers)) push('CARD_LIST_INVALID', 'answers', '"answers" must be an array when present.');
  if (listsOk.length < lists.length) return { valid: false, errors };

  const ids = new Set();
  const spans = [];
  const each = (key, prefix, fn) => card[key].forEach((item, i) => {
    const at = `${key}[${i}]`;
    if (!isPlainObject(item)) { push('CARD_ITEM_NOT_OBJECT', at, 'Must be an object.'); return; }
    if (!isNonEmptyString(item.id) || !ID_RE.test(item.id) || !item.id.startsWith(prefix)) push('CARD_ID_INVALID', `${at}.id`, `"id" must look like ${prefix}1.`);
    else if (ids.has(item.id)) push('CARD_ID_DUPLICATE', `${at}.id`, `Duplicate id "${item.id}".`);
    else ids.add(item.id);
    const spanOk = validSpan(item.span, text.length);
    if (!spanOk) push('CARD_SPAN_INVALID', `${at}.span`, `"span" must be [from, to] inside the text (0 <= from < to <= ${text.length}).`);
    fn(item, at, spanOk);
  });
  const textMatches = (item, at, spanOk, field) => {
    if (!isNonEmptyString(item[field])) push('CARD_TEXT_INVALID', `${at}.${field}`, `"${field}" must be the words as written.`);
    else if (spanOk && text.slice(item.span[0], item.span[1]) !== item[field]) push('CARD_SPAN_TEXT_MISMATCH', `${at}.span`, `"${item[field]}" is not the text at span [${item.span}] ("${text.slice(item.span[0], item.span[1])}").`);
  };

  each('nouns', 'n', (item, at, spanOk) => {
    if (!NOUN_KINDS.includes(item.kind)) push('CARD_KIND_INVALID', `${at}.kind`, `"kind" must be one of: ${NOUN_KINDS.join(', ')}.`);
    if ('properties' in item && !isStringArray(item.properties)) push('CARD_PROPERTIES_INVALID', `${at}.properties`, '"properties" must be an array of names.');
    textMatches(item, at, spanOk, 'text');
    if (spanOk) spans.push({ span: item.span, at });
  });
  const nounIds = new Set(card.nouns.filter(isPlainObject).map((n) => n.id));
  each('verbs', 'v', (item, at, spanOk) => {
    if (!VERB_KINDS.includes(item.kind)) push('CARD_KIND_INVALID', `${at}.kind`, `"kind" must be one of: ${VERB_KINDS.join(', ')}.`);
    textMatches(item, at, spanOk, 'text');
    if (!Array.isArray(item.on)) push('CARD_VERB_TARGET_UNKNOWN', `${at}.on`, '"on" must be an array of noun ids.');
    else for (const id of item.on) if (!nounIds.has(id)) push('CARD_VERB_TARGET_UNKNOWN', `${at}.on`, `"${id}" is not a noun of this card.`);
    if (spanOk) spans.push({ span: item.span, at });
  });
  const covering = [];
  each('checks', 'c', (item, at, spanOk) => {
    if (!isNonEmptyString(item.name) || !(item.name in lexicon.checks)) push('CARD_CHECK_UNKNOWN', `${at}.name`, `"${item.name}" is not a named check. Named checks: ${Object.keys(lexicon.checks).join(', ')}.`);
    if (!isNonEmptyString(item.why)) push('CARD_CHECK_FIELD_INVALID', `${at}.why`, '"why" must say what the check is for.');
    textMatches(item, at, spanOk, 'from');
    if (spanOk) covering.push(item.span);
  });
  each('open', 'o', (item, at, spanOk) => {
    if (!SLOT_OPTIONS[item.slot]) push('CARD_OPEN_INVALID', `${at}.slot`, '"slot" must be "noun" or "verb".');
    if (!isNonEmptyString(item.question)) push('CARD_OPEN_INVALID', `${at}.question`, '"question" must be a non-empty string.');
    textMatches(item, at, spanOk, 'text');
    if (spanOk) spans.push({ span: item.span, at });
  });
  const answers = Array.isArray(card.answers) ? card.answers : [];
  answers.forEach((a, i) => {
    const ok = isPlainObject(a) && validSpan(a.span, text.length) && SLOT_OPTIONS[a.slot]?.includes(a.option) && isNonEmptyString(a.open) && text.slice(a.span[0], a.span[1]) === a.text;
    if (!ok) push('CARD_ANSWER_INVALID', `answers[${i}]`, 'An answer needs { open, text, span, slot, option } where span is the word and option one of its question\'s options.');
    else if (a.option === 'ignore') covering.push(a.span);
  });

  const sorted = [...spans].sort((x, y) => x.span[0] - y.span[0] || x.span[1] - y.span[1]);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].span[0] < sorted[i - 1].span[1]) push('CARD_SPAN_OVERLAP', sorted[i].at, `Overlaps ${sorted[i - 1].at}: one word is claimed twice.`);
  }

  covering.push(...spans.map((s) => s.span));
  for (const tok of tokensOf(text, 0, text.length)) {
    if (tok.brk || index.stops.has(tok.low)) continue;
    if (covering.some(([a, b]) => tok.from >= a && tok.to <= b)) continue;
    push('CARD_COVERAGE_UNCOVERED_WORD', 'source.text', `The word "${tok.text}" at [${tok.from}, ${tok.to}] is not covered by a noun, verb, check or open question, and is not a stop word.`);
  }
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------------------------------------------- read-back

const NOUN_LINE = {
  entity: (n) => `"${n.text}" is a data object${n.properties?.length ? ` with ${n.properties.join(', ')}` : ''}.`,
  state: (n) => `"${n.text}" is a state of the user${n.properties?.length ? `: ${n.properties.join(', ')}` : ''}.`,
  'ui-part': (n) => `"${n.text}" is a part of the screen${n.properties?.length ? ` (${n.properties.join(', ')})` : ''}.`,
  external: (n) => `"${n.text}" is an outside service.`,
};
const VERB_LINE = { read: 'shows', write: 'changes', interact: 'lets the person act on', navigate: 'moves to' };

/**
 * One plain-English line per noun, verb and check, so a person confirms what was understood: `"see" shows "current
 * subscription plan".` Deterministic, built from the card alone.
 *
 * @param {RequirementCard} card A card (valid or not; unknown ids are skipped).
 * @returns {{ id: string, line: string }[]} The lines in reading order (nouns, verbs, checks, open questions).
 *
 * @example
 * readBack(card)[0]; // => { id: 'n1', line: '"logged-in user" is a state of the user: session.' }
 */
export function readBack(card) {
  const byId = new Map((card.nouns ?? []).map((n) => [n.id, n]));
  const lines = [];
  for (const n of card.nouns ?? []) lines.push({ id: n.id, line: (NOUN_LINE[n.kind] ?? (() => `"${n.text}".`))(n) });
  for (const v of card.verbs ?? []) {
    const targets = (v.on ?? []).map((id) => byId.get(id)).filter(Boolean).map((n) => `"${n.text}"`);
    lines.push({ id: v.id, line: `"${v.text}" ${VERB_LINE[v.kind] ?? 'does'} ${targets.length ? targets.join(', ') : 'nothing named yet'}.` });
  }
  for (const c of card.checks ?? []) lines.push({ id: c.id, line: `"${c.from}" needs ${c.name}: ${c.why}` });
  for (const o of card.open ?? []) lines.push({ id: o.id, line: `Open: ${o.question}` });
  return lines.map((l) => ({ id: l.id, line: cap(l.line, CARD_LIMITS.line) }));
}

/**
 * The summary of a card at a fixed maximum size: the sentence (capped), counts, at most 8 nouns, verbs and checks and 5 open
 * questions, and at most 12 read-back lines, with `truncated` set when anything was cut. Absolute size is bounded whatever the
 * input, so a person's screen, an LLM's tool result and a decision model's input are all built from this one object.
 *
 * @param {RequirementCard} card A card.
 * @returns {{ version: string, text: string, counts: { nouns: number, verbs: number, checks: number, open: number }, nouns: object[], verbs: object[], checks: object[], open: object[], readBack: string[], truncated: boolean }} The summary.
 *
 * @example
 * cardSummary(card).counts; // => { nouns: 5, verbs: 3, checks: 3, open: 0 }
 */
export function cardSummary(card) {
  const max = CARD_LIMITS.items;
  const nouns = card.nouns ?? [];
  const verbs = card.verbs ?? [];
  const checks = card.checks ?? [];
  const open = card.open ?? [];
  const lines = readBack(card);
  const counts = { nouns: nouns.length, verbs: verbs.length, checks: checks.length, open: open.length };
  const openMax = CARD_LIMITS.maxOptions;
  const text = String(card.source?.text ?? '');
  return {
    version: card.version,
    text: cap(text, CARD_LIMITS.text),
    counts,
    nouns: nouns.slice(0, max).map((n) => ({ id: n.id, kind: n.kind, text: cap(n.text, CARD_LIMITS.label) })),
    verbs: verbs.slice(0, max).map((v) => ({ id: v.id, kind: v.kind, text: cap(v.text, CARD_LIMITS.label), on: (v.on ?? []).slice(0, max) })),
    checks: checks.slice(0, max).map((c) => ({ id: c.id, name: cap(c.name, CARD_LIMITS.label), from: cap(c.from, CARD_LIMITS.label) })),
    open: open.slice(0, openMax).map((o) => ({ id: o.id, question: cap(o.question, CARD_LIMITS.question) })),
    readBack: lines.slice(0, CARD_LIMITS.lines).map((l) => l.line),
    truncated: nouns.length > max || verbs.length > max || checks.length > max || open.length > openMax || text.length > CARD_LIMITS.text || lines.length > CARD_LIMITS.lines,
  };
}
