// #387 (design docs/design/ia-five-screens.md 9.6, "If the user chooses extraction on every use") -- the mechanical
// verification step: every field an AI extraction proposed must be QUOTED TEXT found in the fetched page text, or
// it is rejected or flagged, never written as-is. This is what makes "extraction cannot invent content" true
// mechanically rather than by asking the model nicely -- a hallucinated field simply never appears in the source
// text and fails the substring check, deterministically, with no model call spent checking it.
//
// Pure and deterministic: no model, no network, no fs. The only normalisation applied to either side is whitespace
// collapse (real page text wraps and indents; the model's quoted text usually does not), never fuzzy matching --
// a value that is close but not an exact (whitespace-normalised) substring is still rejected.
const collapse = (s) => String(s).replace(/\s+/g, ' ').trim();

/** Is `value` present, verbatim (whitespace-normalised), in `pageText`? */
export function isQuotedIn(pageText, value) {
  if (typeof value !== 'string' || value === '') return false;
  return collapse(pageText).includes(collapse(value));
}

/**
 * Verify every field an AI extraction proposed against the page text it was extracted from. A field whose value is
 * an array (a list field, e.g. `acceptance`) is verified item by item; the field is verified only when every item
 * is quoted text.
 *
 * @param {string} pageText The fetched, sanitised page text the extraction was run against.
 * @param {Record<string, string|string[]>} values The AI's proposed field values.
 * @returns {{ verified: Record<string, string|string[]>, rejected: {name:string, value:string|string[], reason:string}[] }}
 *   `verified` carries only the fields (and, for a list field, only the items) that were found verbatim in
 *   `pageText`; `rejected` names every field that failed, in input order, so a caller can show or drop it (design:
 *   "rejected or flagged" -- this module always reports both, the caller decides which behaviour it wants).
 *
 * @example
 * verifyExtraction('The button shows only on delivered orders.', { title: 'shows only on delivered orders' }).verified.title;
 * // => 'shows only on delivered orders'
 */
export function verifyExtraction(pageText, values) {
  const verified = {};
  const rejected = [];
  const text = typeof pageText === 'string' ? pageText : '';
  for (const [name, value] of Object.entries(values ?? {})) {
    if (Array.isArray(value)) {
      const kept = value.filter((v) => isQuotedIn(text, v));
      const dropped = value.filter((v) => !isQuotedIn(text, v));
      if (kept.length) verified[name] = kept;
      for (const v of dropped) rejected.push({ name, value: v, reason: 'Not found verbatim in the fetched page text.' });
      continue;
    }
    if (isQuotedIn(text, value)) verified[name] = value;
    else rejected.push({ name, value, reason: 'Not found verbatim in the fetched page text.' });
  }
  return { verified, rejected };
}
