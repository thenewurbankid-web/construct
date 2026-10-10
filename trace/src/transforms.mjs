// The transform library: a fixed, closed set of deterministic functions.
// The matcher tries these against the mock API data to explain each page value.
// Add a transform here once and every future page can use it.

// ---- formatters (value -> display text). Source is copied into generated Domain code via Function#toString,
// which does not include this JSDoc (it starts at the `function` keyword), so documenting these is safe for
// generated-output determinism.
/**
 * Identity formatter: renders a value as plain text.
 *
 * @param {*} v Any value.
 * @returns {string} `String(v)`.
 */
export function asText(v) {
  return String(v);
}
/**
 * Money, rounded to the nearest billion/million/thousand with one decimal (e.g. `1234567` -> `"$1.2M"`).
 *
 * @param {number|string} v A numeric amount.
 * @returns {string} `$` plus the compact amount.
 */
export function moneyCompact(v) {
  const n = Number(v);
  const units = [[1e9, "B"], [1e6, "M"], [1e3, "K"]];
  for (const [size, suffix] of units) {
    if (Math.abs(n) >= size) return "$" + (n / size).toFixed(1) + suffix;
  }
  return "$" + n.toFixed(0);
}
// 0.327 -> "33%" (no decimals)
/**
 * A fraction as a whole-number percent, e.g. `0.327` -> `"33%"`.
 *
 * @param {number|string} v A fraction (0-1).
 * @returns {string} The rounded percent, with a trailing `%`.
 */
export function percentWhole(v) {
  return Math.round(Number(v) * 100) + "%";
}
/**
 * Money with thousands separators and no rounding, e.g. `1234567` -> `"$1,234,567"`.
 *
 * @param {number|string} v A numeric amount.
 * @returns {string} `$` plus the amount, formatted with `en-US` grouping.
 */
export function moneyFull(v) {
  return "$" + Number(v).toLocaleString("en-US");
}
/**
 * A fraction as a percent with one decimal, e.g. `0.327` -> `"32.7%"`.
 *
 * @param {number|string} v A fraction (0-1).
 * @returns {string} The percent to one decimal place, with a trailing `%`.
 */
export function percent(v) {
  return (Number(v) * 100).toFixed(1) + "%";
}
/**
 * A date as `D Mon YYYY` in UTC, e.g. `"2026-09-27"` -> `"27 Sep 2026"`.
 *
 * @param {string|number|Date} v Anything `Date` accepts.
 * @returns {string} The short date.
 */
export function dateShort(v) {
  const d = new Date(v);
  const m = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return d.getUTCDate() + " " + m[d.getUTCMonth()] + " " + d.getUTCFullYear();
}

export const FORMATTERS = [
  { name: "asText", fn: asText, cost: 0 },
  { name: "moneyCompact", fn: moneyCompact, cost: 1 },
  { name: "moneyFull", fn: moneyFull, cost: 1 },
  { name: "percentWhole", fn: percentWhole, cost: 1 },
  { name: "percent", fn: percent, cost: 1 },
  { name: "dateShort", fn: dateShort, cost: 1, accepts: (v) => typeof v === "string" && /^\d{4}-\d\d-\d\d/.test(v) },
];

// ---- aggregates (list -> value), used for values outside the list
export const AGGREGATES = [
  { name: "count", needsField: false, fn: (items) => items.length, code: (list) => `${list}.length` },
  { name: "sum", needsField: true, fn: (items, f) => items.reduce((s, x) => s + Number(x[f]), 0),
    code: (list, f) => `${list}.reduce((s, x) => s + Number(x.${f}), 0)` },
  { name: "average", needsField: true, fn: (items, f) => items.reduce((s, x) => s + Number(x[f]), 0) / items.length,
    code: (list, f) => `(${list}.length ? ${list}.reduce((s, x) => s + Number(x.${f}), 0) / ${list}.length : 0)` },
  { name: "max", needsField: true, fn: (items, f) => Math.max(...items.map((x) => Number(x[f]))),
    code: (list, f) => `(${list}.length ? Math.max(...${list}.map((x) => Number(x.${f}))) : 0)` },
  { name: "min", needsField: true, fn: (items, f) => Math.min(...items.map((x) => Number(x[f]))),
    code: (list, f) => `(${list}.length ? Math.min(...${list}.map((x) => Number(x.${f}))) : 0)` },
];

/**
 * Collapse runs of whitespace to a single space and trim the ends. Used to compare text loosely (e.g. page text
 * against mock-API values) without caring about line breaks or extra spacing.
 *
 * @param {*} s Anything coercible to a string.
 * @returns {string} The normalized text.
 */
export const normalize = (s) => String(s).replace(/\s+/g, " ").trim();
