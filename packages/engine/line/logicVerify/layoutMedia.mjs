// Line logic verification, spec E (step 5): matchMedia for the layout fakes. Parses a media query list (Media Queries
// level 4: comma-separated queries, `not` / `only`, media types, `and`, `(min-width: 768px)`, `(max-height: 40em)`,
// range syntax `(width >= 768px)` and `(400px <= width < 800px)`, orientation and a fixed set of user preferences) and
// evaluates it against the fake viewport. A feature the fakes do not model throws NotFakedError naming it.
import { NotFakedError } from './notFaked.mjs';

/** px per em / rem in a media query (the initial font size, as browsers use for media queries). */
export const EM_PX = 16;
/** The fixed answers for the non-layout features a query may test. */
export const MEDIA_PREFERENCES = Object.freeze({
  'prefers-color-scheme': 'light', 'prefers-reduced-motion': 'no-preference', 'prefers-contrast': 'no-preference',
  hover: 'hover', 'any-hover': 'hover', pointer: 'fine', 'any-pointer': 'fine', scripting: 'enabled',
});
const DIMENSIONS = new Set(['width', 'height']);
const TYPES = new Set(['all', 'screen', 'print', 'speech']);

/**
 * One feature test: `name` is width, height, orientation or a MEDIA_PREFERENCES key; `op` is <, <=, =, >=, > (a
 * min-/max- prefix becomes >= / <=); `value` is px for a dimension, else the keyword; a bare `(hover)` has no op.
 * @typedef {{name: string, op?: '<'|'<='|'='|'>='|'>', value?: number|string}} MediaFeature
 */
/** @typedef {{not: boolean, type: string, features: MediaFeature[]}} MediaQuery */

function length(text, query) {
  const m = String(text).trim().match(/^(-?\d+(?:\.\d+)?)(px|em|rem)?$/);
  if (!m) throw new TypeError(`The media query "${query}" has a length "${text}" that is not px, em or rem.`);
  return Number(m[1]) * (m[2] === 'em' || m[2] === 'rem' ? EM_PX : 1);
}
const FLIP = { '<': '>', '<=': '>=', '>': '<', '>=': '<=', '=': '=' };

/**
 * One `( ... )` feature into its tests (a double range gives two).
 * @param {string} body
 * @param {string} query
 * @returns {MediaFeature[]}
 */
function feature(body, query) {
  /** @type {(op: string) => MediaFeature['op']} */
  const asOp = (op) => /** @type {MediaFeature['op']} */ (op);
  const range = body.match(/^(.+?)\s*(<=|>=|<|>|=)\s*(.+?)(?:\s*(<=|>=|<|>|=)\s*(.+))?$/);
  if (range && !body.includes(':')) {
    const [, a, op1, b, op2, c] = range;
    if (op2) {
      if (!DIMENSIONS.has(b.trim())) throw new TypeError(`The media query "${query}" has a range on "${b.trim()}", not width or height.`);
      return [{ name: b.trim(), op: asOp(FLIP[op1]), value: length(a, query) }, { name: b.trim(), op: asOp(op2), value: length(c, query) }];
    }
    if (DIMENSIONS.has(a.trim())) return [{ name: a.trim(), op: asOp(op1), value: length(b, query) }];
    if (DIMENSIONS.has(b.trim())) return [{ name: b.trim(), op: asOp(FLIP[op1]), value: length(a, query) }];
    throw new TypeError(`The media query "${query}" has a range on neither width nor height.`);
  }
  const [rawName, rawValue] = body.split(':').map((s) => s.trim());
  const pre = rawName.match(/^(min|max)-(.+)$/);
  const name = pre ? pre[2] : rawName;
  if (DIMENSIONS.has(name)) {
    if (rawValue === undefined) return [{ name }];
    return [{ name, op: pre ? (pre[1] === 'min' ? '>=' : '<=') : '=', value: length(rawValue, query) }];
  }
  if (name === 'orientation' || name in MEDIA_PREFERENCES) return [rawValue === undefined ? { name } : { name, op: '=', value: rawValue }];
  throw new NotFakedError('MediaQueryList', `(${rawName})`, false, `the layout fakes model width, height, orientation and ${Object.keys(MEDIA_PREFERENCES).join(', ')}`);
}

/**
 * Parse a media query list.
 * @param {string} query e.g. `screen and (min-width: 768px), print`.
 * @returns {MediaQuery[]}
 */
export function parseMediaQuery(query) {
  const text = String(query).trim().toLowerCase();
  if (!text) return [{ not: false, type: 'all', features: [] }];
  return text.split(',').map((part) => {
    let rest = part.trim();
    let not = false;
    const head = rest.match(/^(not|only)\s+/);
    if (head) { not = head[1] === 'not'; rest = rest.slice(head[0].length); }
    let type = 'all';
    const t = rest.match(/^([a-z]+)\b\s*(?:and\s+)?/);
    if (t && !rest.startsWith('(')) {
      if (!TYPES.has(t[1])) throw new TypeError(`The media query "${query}" has an unknown media type "${t[1]}".`);
      type = t[1];
      rest = rest.slice(t[0].length);
    }
    const features = [];
    for (const piece of rest ? rest.split(/\)\s*and\s*\(|^\(|\)$/).filter((s) => s.trim()) : []) features.push(...feature(piece.trim(), query));
    if (rest && !/^\(.*\)$/.test(rest.trim())) throw new TypeError(`The media query "${query}" is not "type and (feature) and (feature)".`);
    return { not, type, features };
  });
}

const cmp = (a, op, b) => (op === '<' ? a < b : op === '<=' ? a <= b : op === '>' ? a > b : op === '>=' ? a >= b : a === b);

/**
 * Whether a media query list matches the fake viewport.
 * @param {string|MediaQuery[]} query
 * @param {{width: number, height: number}} viewport
 * @returns {boolean}
 */
export function matchesMedia(query, viewport) {
  const list = typeof query === 'string' ? parseMediaQuery(query) : query;
  return list.some((q) => {
    const typeOk = q.type === 'all' || q.type === 'screen';
    const ok = typeOk && q.features.every((f) => {
      if (f.name === 'width' || f.name === 'height') {
        const v = f.name === 'width' ? viewport.width : viewport.height;
        return f.op ? cmp(v, f.op, /** @type {number} */ (f.value)) : v > 0;
      }
      if (f.name === 'orientation') {
        const o = viewport.height >= viewport.width ? 'portrait' : 'landscape';
        return f.value === undefined || f.value === o;
      }
      const pref = MEDIA_PREFERENCES[/** @type {keyof typeof MEDIA_PREFERENCES} */ (f.name)];
      return f.value === undefined ? pref !== 'no-preference' : f.value === pref;
    });
    return q.not ? !ok : ok;
  });
}
