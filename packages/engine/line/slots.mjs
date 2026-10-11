// Slots: the ONE place for what every delexicalized Line record shares. A stored record (a plan record,
// records.mjs; a drafter transition, drafter/retrieval.mjs; a Train Line case, train/) holds typed slots such as
// "<feature:F1>" instead of a project's names, so the words of a name and the check that nothing leaked live here.
// Each record kind keeps its own slot ids (a plan record's "<item:I2 kind=components>", a transition's "<C1>", a case's
// "<item:I1>"), because each is read by a different consumer; the words and the guard are the same.

/**
 * Split an identifier or phrase into lowercase words (camelCase, PascalCase, kebab, snake, digits):
 * "OrderButton" -> ["order", "button"], "order-items" -> ["order", "items"].
 * @param {string} s
 * @returns {string[]}
 */
export function splitWords(s) {
  return String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w.toLowerCase());
}

/**
 * The first of `words` that a stored value holds as a whole word (any case), or null: the delexicalization check every
 * record kind runs before it is kept. Words shorter than three letters are ignored.
 * @param {unknown} value A record, or its stored text.
 * @param {string[]} words The project's names and domain words.
 * @returns {string|null}
 */
export function projectWordIn(value, words) {
  const text = (typeof value === 'string' ? value : JSON.stringify(value)).toLowerCase();
  for (const w of words) {
    if (!w || w.length < 3) continue;
    const re = new RegExp(`(^|[^a-z0-9])${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`);
    if (re.test(text)) return w;
  }
  return null;
}
