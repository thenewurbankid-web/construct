// #439 -- extract/verify: parse HTML fetched through safeFetch (#436, safeFetch.mjs) and pull out picked fields by
// CSS or XPath selector, using `linkedom` (ISC) instead of a hand-rolled parser or a browser-grade DOM (jsdom/happy-dom).
// linkedom has no JavaScript engine and does no networking of its own, so a <script> never runs and an <img>/<iframe>/
// stylesheet src is never fetched here -- parsing is pure string-in, DOM-in-memory, JSON-out. The DOM itself never
// leaves this file: `extract`/`verify` return only plain JSON (`values`, `misses`), already HTML-escaped, so whatever
// calls this can hand the result straight to the Cockpit without a second escaping step.
//
// #387 -- XPath support: `xpath` (MIT) evaluates XPath 1.0 node-set paths over a linkedom tree. Two quirks needed a
// spike (against `docs/design/ia-five-screens.md` 9.2's own example selector) before this was trusted:
//   1. linkedom assigns every HTML element the xhtml namespace, which would silently fail every unprefixed step
//      (`//h1` matches nothing per the XPath spec's namespace rule) unless evaluated with `{ isHtml: true }`.
//   2. A leading `<!DOCTYPE html>` -- present on almost every real page -- makes `xpath`'s tree walk return an
//      EMPTY result from `document` (and even from `document.documentElement`), no error, just zero matches
//      (their walk loses its place at the doctype node). CSS's `querySelectorAll` is unaffected. XPath fields
//      therefore parse a second, doctype-stripped tree (`xpathDocument`, below); it has the same content as the
//      main tree so extracted values are identical either way, only the DOM instance differs.
//
// The multiple-match rule (design 9.6b): a field marked `list` takes every match, in document order; any other
// field errors (`ambiguous`, not `values`) when more than one node matched, so a single-value field can never
// silently pick "the first one" the way a plain `querySelector` would.
import { parseHTML } from 'linkedom';
import xpath from 'xpath';

export const DEFAULT_MAX_HTML_BYTES = 2_000_000;
export const DEFAULT_TIMEOUT_MS = 5_000;
export const MAX_FIELDS = 50;
export const MAX_SELECTOR_LENGTH = 300;

/** @param {string} code @param {string} message @returns {{ok:false, code:string, message:string}} */
const fail = (code, message) => ({ ok: false, code, message });
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

// ---- escaping ------------------------------------------------------------------------------------------------------

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

/** Escape a plain string for safe interpolation into HTML; every extracted value passes through this before it is
 * returned, so a story page cannot smuggle markup into the Cockpit through a field's text.
 * @param {*} value - the raw value to escape (coerced to a string).
 * @returns {string} the value with `& < > " '` replaced by their HTML entities.
 */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

// ---- field validation -----------------------------------------------------------------------------------------------

function isValidField(f) {
  if (!isPlainObject(f)) return false;
  if (typeof f.name !== 'string' || f.name.length === 0) return false;
  if (typeof f.selector !== 'string' || f.selector.length === 0 || f.selector.length > MAX_SELECTOR_LENGTH) return false;
  if (f.kind !== undefined && f.kind !== 'css' && f.kind !== 'xpath') return false;
  if (f.attr !== undefined && (typeof f.attr !== 'string' || f.attr.length === 0)) return false;
  if (f.list !== undefined && typeof f.list !== 'boolean') return false;
  return true;
}

/** Validate `fields` on its own, for callers that want to fail fast before fetching or parsing anything.
 * @param {object[]} fields - the field descriptors ({name, selector, kind?, attr?, list?}) to validate.
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

const ATTRIBUTE_NODE = 2;

/** Read one node's text (or, for an element, its `attr`); an XPath attribute-node step (`@href`) carries its
 * value directly and ignores `attr` (there is nothing further to read off an attribute). */
function readValue(node, attr) {
  if (!node) return undefined;
  const raw = node.nodeType === ATTRIBUTE_NODE ? node.value : (attr ? node.getAttribute?.(attr) : node.textContent);
  if (raw === null || raw === undefined) return undefined;
  const trimmed = String(raw).trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Every node a field's selector matches, in document order. `docs` carries both parsed trees (`document` for CSS,
 * a lazily-built `xpathDocument` for XPath -- see the doctype note above). Throws on a bad CSS selector (caught by
 * the caller); an invalid XPath is already refused earlier (storySelectors.mjs, #384) so it is not re-validated here. */
function selectNodes(docs, field) {
  // The `xpath` package's shipped .d.ts omits `parse` (it only declares `select`/`select1`/...), even though the
  // runtime module exports it; cast around the incomplete third-party types rather than reimplementing `select`'s
  // one-shot form.
  if (field.kind === 'xpath') return /** @type {any} */ (xpath).parse(field.selector).select({ node: docs.xpathDocument(), isHtml: true });
  return Array.from(docs.document.querySelectorAll(field.selector));
}

/**
 * Parse `html` and read one value per field, by CSS or XPath selector. Byte and time budgets are checked BEFORE the
 * parser or any selector runs, so a caller never spends work on input that will be refused anyway; each selector is
 * bounded by its own length cap and the shared time budget, so one pathological selector cannot hang the whole call.
 * The multiple-match rule (design 9.6b): a `list` field's value is every match, in document order; any other field
 * with more than one match is `ambiguous`, not a value (never silently "the first one").
 *
 * @param {string} html
 * @param {{ fields?: {name:string, selector:string, kind?:'css'|'xpath', attr?:string, list?:boolean}[], maxBytes?:number, timeoutMs?:number }} [opts]
 *   `fields` is required at runtime; a missing/invalid one fails validation (`BAD_FIELDS`) rather than throwing.
 * @returns {{ ok:boolean, values:Record<string,string|string[]>, misses:string[], ambiguous:string[] } | { ok:false, code:string, message:string }}
 *   On a hard failure (bad input, over budget, unparseable) there is no `values`/`misses`/`ambiguous`; on a normal
 *   run `ok` is true only when every field matched exactly (no miss, no ambiguity) -- a story extraction with
 *   misses or ambiguous fields is not an error, just incomplete.
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

  let xpathDoc;
  const docs = {
    document,
    xpathDocument: () => {
      if (!xpathDoc) xpathDoc = parseHTML(html.replace(/^\s*<!DOCTYPE[^>]*>/i, '')).document;
      return xpathDoc;
    },
  };

  /** @type {Record<string, string|string[]>} */
  const values = {};
  const misses = [];
  const ambiguous = [];
  for (const f of fields) {
    if (Date.now() > deadline) return fail('TIMEOUT', 'Extraction took too long.');
    let nodes;
    try {
      nodes = selectNodes(docs, f);
    } catch (e) {
      return fail('BAD_SELECTOR', `Selector "${f.selector}" is not valid: ${String(e?.message || e).slice(0, 120)}`);
    }
    if (f.list) {
      const list = nodes.map((n) => readValue(n, f.attr)).filter((v) => v !== undefined).map(escapeHtml);
      if (list.length === 0) misses.push(f.name);
      else values[f.name] = list;
      continue;
    }
    if (nodes.length > 1) { ambiguous.push(f.name); continue; }
    const raw = readValue(nodes[0], f.attr);
    if (raw === undefined) misses.push(f.name);
    else values[f.name] = escapeHtml(raw);
  }
  return { ok: misses.length === 0 && ambiguous.length === 0, values, misses, ambiguous };
}

function valuesDiffer(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    const [x, y] = [a, b].map((v) => (Array.isArray(v) ? v : v === undefined ? [] : [v]));
    return x.length !== y.length || x.some((v, i) => v !== y[i]);
  }
  return a !== b;
}

/**
 * Re-extract `html` with the field definitions from a previous `extract()` and compare against its values, so a
 * caller can tell whether a story page changed since it was last fetched without diffing raw HTML.
 *
 * @param {string} html
 * @param {{ fields: {name:string, selector:string, kind?:'css'|'xpath', attr?:string, list?:boolean}[], values: Record<string,string|string[]> }} previous
 *   The `fields` and `values` from an earlier `extract()` call.
 * @param {{ maxBytes?:number, timeoutMs?:number }} [opts]
 * @returns {{ ok:boolean, values:Record<string,string|string[]>, misses:string[], changed:string[] } | { ok:false, code:string, message:string }}
 *   `changed` lists the field names whose value differs from `previous.values` (a field that newly matches or newly
 *   misses counts as changed). A hard failure from `extract()` (bad input, over budget) passes straight through.
 */
export function verify(html, previous, opts = {}) {
  if (!isPlainObject(previous) || !Array.isArray(previous.fields) || !isPlainObject(previous.values)) {
    return fail('BAD_PREVIOUS', 'previous must be { fields, values } from an earlier extract().');
  }
  const result = extract(html, { ...opts, fields: previous.fields });
  if (!('values' in result)) return result;
  const changed = Object.keys(previous.values).filter((name) => valuesDiffer(result.values[name], previous.values[name]));
  return { ok: result.ok && changed.length === 0, values: result.values, misses: result.misses, changed };
}
