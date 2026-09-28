// #384 (design: docs/design/ia-five-screens.md 9.6b) -- what a `story.md` front-matter `parse` value is allowed to
// say, and the multiple-match rule once matches exist. Pure and deterministic: no DOM, no fs, no network. Applying a
// validated selector to fetched HTML (the CSS/XPath engine itself) is a later slice (#387) once the HTML-parsing
// dependency is chosen by its own spike; this module only answers "is this selector text safe to keep and to run".
export const MAX_SELECTOR_LENGTH = 200;

/** A single-value field errors on >1 match; a list field takes every match. `docs/design/ia-five-screens.md` 9.6b. */
export const SINGLE_VALUE_FIELDS = Object.freeze(['title', 'description', 'status']);
export const LIST_FIELDS = Object.freeze(['acceptance']);

export class SelectorError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'SelectorError';
    this.code = code;
  }
}

// CSS: letters, digits, whitespace and the punctuation real selectors use (combinators, attribute brackets,
// pseudo-classes, quoting). No backslash escapes, no `{`/`}`/`;`/`@` (rules out embedded declarations / at-rules),
// no backtick.
const CSS_SAFE = /^[A-Za-z0-9\s#.,:()[\]='"*>+~^$|_-]+$/;
// XPath 1.0 node-set paths: letters, digits, whitespace, path/step/predicate punctuation, quoting and the axis
// separator `::`. No backslash, `{`/`}`/`;`/backtick either.
const XPATH_SAFE = /^[A-Za-z0-9\s./:@*()[\]='"_-]+$/;
// Banned regardless of dialect: anything that could execute script, or (XPath) load or reach outside the
// document being evaluated.
const BANNED = [
  [/javascript\s*:/i, 'must not contain "javascript:"'],
  [/expression\s*\(/i, 'must not contain a CSS expression()'],
  [/\burl\s*\(/i, 'must not contain url(...)'],
  [/\bdocument\s*\(/i, 'must not call document() (it loads a different document)'],
  [/\bid\s*\(/i, 'must not call id() (it can reach outside the fetched tree)'],
  [/\bsystem-property\s*\(/i, 'must not call system-property()'],
  [/\bunparsed-(text|entity)\s*\(/i, 'must not read unparsed text or entities'],
];

function checkCommon(value, kind) {
  if (typeof value !== 'string' || value === '') throw new SelectorError('EMPTY', 'A selector is required.');
  if (value.length > MAX_SELECTOR_LENGTH) {
    throw new SelectorError('TOO_LONG', `A selector may be at most ${MAX_SELECTOR_LENGTH} characters.`);
  }
  for (const [pattern, reason] of BANNED) {
    if (pattern.test(value)) throw new SelectorError('BANNED_CONSTRUCT', `That ${kind} selector ${reason}.`);
  }
}

/** @param {string} value a CSS selector, evaluated only through `querySelectorAll`. */
export function validateCssSelector(value) {
  checkCommon(value, 'CSS');
  if (!CSS_SAFE.test(value)) throw new SelectorError('BAD_SYNTAX', 'That CSS selector uses characters that are not allowed.');
  return { kind: 'css', value };
}

/** @param {string} value an XPath 1.0 node-set path, evaluated only through `document.evaluate` (browser) or an
 *   XPath 1.0 engine over a parsed HTML tree (server). No positional-index guidance is enforced here (that is a
 *   picker concern, #386); this only rejects unsafe forms. */
export function validateXPathSelector(value) {
  checkCommon(value, 'XPath');
  if (!XPATH_SAFE.test(value)) throw new SelectorError('BAD_SYNTAX', 'That XPath selector uses characters that are not allowed.');
  return { kind: 'xpath', value };
}

/**
 * One `parse` entry: a plain string (CSS) or `{css}` / `{xpath}`.
 * @param {unknown} descriptor
 */
export function validateSelectorDescriptor(descriptor) {
  if (typeof descriptor === 'string') return validateCssSelector(descriptor);
  if (descriptor && typeof descriptor === 'object' && !Array.isArray(descriptor)) {
    const keys = Object.keys(descriptor);
    if (keys.length === 1 && keys[0] === 'css') return validateCssSelector(descriptor.css);
    if (keys.length === 1 && keys[0] === 'xpath') return validateXPathSelector(descriptor.xpath);
  }
  throw new SelectorError('BAD_SHAPE', 'A selector must be a CSS string, {css: "..."} or {xpath: "..."}.');
}

/**
 * The whole `parse` map of a story source: `{ title, description, status, acceptance, ... }`.
 * @param {unknown} parse
 * @returns {Record<string, {kind:'css'|'xpath', value:string}>}
 */
export function validateParseSpec(parse) {
  if (parse === undefined || parse === null) return {};
  if (typeof parse !== 'object' || Array.isArray(parse)) throw new SelectorError('BAD_SHAPE', 'parse must be an object of field -> selector.');
  const out = {};
  for (const [field, descriptor] of Object.entries(parse)) {
    try {
      out[field] = validateSelectorDescriptor(descriptor);
    } catch (e) {
      if (e instanceof SelectorError) throw new SelectorError(e.code, `Field "${field}": ${e.message}`);
      throw e;
    }
  }
  return out;
}

/**
 * The multiple-match rule (9.6b): a list field takes every match in document order; any other field errors when
 * more than one node matched, and errors ("did not match") when none did.
 * @param {string} field
 * @param {unknown[]} matches values already extracted from the matched nodes, in document order
 * @returns {{ok:true, values:unknown[]} | {ok:false, code:string, message:string}}
 */
export function applyMultiMatchRule(field, matches) {
  const list = Array.isArray(matches) ? matches : [];
  if (LIST_FIELDS.includes(field)) return { ok: true, values: list };
  if (list.length === 0) return { ok: false, code: 'NO_MATCH', message: 'That selector did not match: re-pick.' };
  if (list.length > 1) return { ok: false, code: 'AMBIGUOUS', message: `That selector matches ${list.length}, make it more specific.` };
  return { ok: true, values: [list[0]] };
}
