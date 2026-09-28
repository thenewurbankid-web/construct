// #439 -- extract/verify: parse HTML fetched through safeFetch (#436, safeFetch.mjs) and pull out picked fields by
// CSS selector, using `linkedom` (ISC) instead of a hand-rolled parser or a browser-grade DOM (jsdom/happy-dom).
// linkedom has no JavaScript engine and does no networking of its own, so a <script> never runs and an <img>/<iframe>/
// stylesheet src is never fetched here -- parsing is pure string-in, DOM-in-memory, JSON-out. The DOM itself never
// leaves this file: `extract`/`verify` return only plain JSON (`values`, `misses`), already HTML-escaped, so whatever
// calls this can hand the result straight to the Cockpit without a second escaping step.
//
// XPath is intentionally left out (the report for #439 leaves it opt-in for #387 only if that story needs it); a field
// names a CSS selector only.
import { parseHTML } from 'linkedom';

export const DEFAULT_MAX_HTML_BYTES = 2_000_000;
export const DEFAULT_TIMEOUT_MS = 5_000;
export const MAX_FIELDS = 50;
export const MAX_SELECTOR_LENGTH = 300;

const fail = (code, message) => ({ ok: false, code, message });
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// ---- escaping ------------------------------------------------------------------------------------------------------

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape a plain string for safe interpolation into HTML; every extracted value passes through this before it is
 * returned, so a story page cannot smuggle markup into the Cockpit through a field's text. */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

// ---- field validation -----------------------------------------------------------------------------------------------

function isValidField(f) {
  if (!isPlainObject(f)) return false;
  if (typeof f.name !== 'string' || f.name.length === 0) return false;
  if (typeof f.selector !== 'string' || f.selector.length === 0 || f.selector.length > MAX_SELECTOR_LENGTH) return false;
  if (f.kind !== undefined && f.kind !== 'css') return false; // xpath: opt-in only, not implemented here (#439)
  if (f.attr !== undefined && (typeof f.attr !== 'string' || f.attr.length === 0)) return false;
  return true;
}

/** Validate `fields` on its own, for callers that want to fail fast before fetching or parsing anything.
 * @returns {{ valid: boolean, errors: string[] }} */
export function validateFields(fields) {
  const errors = [];
  if (!Array.isArray(fields) || fields.length === 0) errors.push('fields must be a non-empty array.');
  else if (fields.length > MAX_FIELDS) errors.push(`More than ${MAX_FIELDS} fields.`);
  else {
    const names = new Set();
    fields.forEach((f, i) => {
      if (!isValidField(f)) { errors.push(`fields[${i}] is invalid: ${JSON.stringify(f)}.`); return; }
      if (names.has(f.name)) errors.push(`Duplicate field name "${f.name}".`);
      names.add(f.name);
    });
  }
  return { valid: errors.length === 0, errors };
}

function readValue(el, attr) {
  if (!el) return undefined;
  const raw = attr ? el.getAttribute(attr) : el.textContent;
  if (raw === null || raw === undefined) return undefined;
  const trimmed = attr ? raw : raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Parse `html` and read one value per field, by CSS selector. Byte and time budgets are checked BEFORE the parser or
 * any selector runs, so a caller never spends work on input that will be refused anyway; each selector is bounded by
 * its own length cap and the shared time budget, so one pathological selector cannot hang the whole call.
 *
 * @param {string} html
 * @param {{ fields: {name:string, selector:string, kind?:'css', attr?:string}[], maxBytes?:number, timeoutMs?:number }} opts
 * @returns {{ ok:boolean, values:Record<string,string>, misses:string[] } | { ok:false, code:string, message:string }}
 *   On a hard failure (bad input, over budget, unparseable) there is no `values`/`misses`; on a normal run `ok` is
 *   true only when every field matched -- a story extraction with misses is not an error, just incomplete.
 */
export function extract(html, opts = {}) {
  const { fields, maxBytes = DEFAULT_MAX_HTML_BYTES, timeoutMs = DEFAULT_TIMEOUT_MS } = opts;
  if (typeof html !== 'string') return fail('BAD_HTML', 'html must be a string.');
  if (Buffer.byteLength(html, 'utf8') > maxBytes) return fail('TOO_LARGE', `HTML is larger than ${maxBytes} bytes.`);
  const shape = validateFields(fields);
  if (!shape.valid) return fail('BAD_FIELDS', shape.errors.join(' '));

  const deadline = Date.now() + timeoutMs;
  let document;
  try {
    ({ document } = parseHTML(html));
  } catch (e) {
    return fail('PARSE_FAILED', `Could not parse HTML: ${String(e?.message || e).slice(0, 200)}`);
  }
  if (Date.now() > deadline) return fail('TIMEOUT', 'Parsing took too long.');

  const values = {};
  const misses = [];
  for (const f of fields) {
    if (Date.now() > deadline) return fail('TIMEOUT', 'Extraction took too long.');
    let el;
    try {
      el = document.querySelector(f.selector);
    } catch (e) {
      return fail('BAD_SELECTOR', `Selector "${f.selector}" is not valid: ${String(e?.message || e).slice(0, 120)}`);
    }
    const raw = readValue(el, f.attr);
    if (raw === undefined) misses.push(f.name);
    else values[f.name] = escapeHtml(raw);
  }
  return { ok: misses.length === 0, values, misses };
}

/**
 * Re-extract `html` with the field definitions from a previous `extract()` and compare against its values, so a
 * caller can tell whether a story page changed since it was last fetched without diffing raw HTML.
 *
 * @param {string} html
 * @param {{ fields: {name:string, selector:string, kind?:'css', attr?:string}[], values: Record<string,string> }} previous
 *   The `fields` and `values` from an earlier `extract()` call.
 * @param {{ maxBytes?:number, timeoutMs?:number }} [opts]
 * @returns {{ ok:boolean, values:Record<string,string>, misses:string[], changed:string[] } | { ok:false, code:string, message:string }}
 *   `changed` lists the field names whose value differs from `previous.values` (a field that newly matches or newly
 *   misses counts as changed). A hard failure from `extract()` (bad input, over budget) passes straight through.
 */
export function verify(html, previous, opts = {}) {
  if (!isPlainObject(previous) || !Array.isArray(previous.fields) || !isPlainObject(previous.values)) {
    return fail('BAD_PREVIOUS', 'previous must be { fields, values } from an earlier extract().');
  }
  const result = extract(html, { ...opts, fields: previous.fields });
  if (!('values' in result)) return result;
  const changed = Object.keys(previous.values).filter((name) => result.values[name] !== previous.values[name]);
  return { ok: result.ok && changed.length === 0, values: result.values, misses: result.misses, changed };
}
