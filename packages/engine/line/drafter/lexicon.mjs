// The shared, curated general business lexicon shipped with Line (owner 2026-10-11, option B): lexicon.json, static and
// versioned, never built from users' projects. Used only to (a) suggest the slot for an unmatched word as a one-click
// confirm ("Did you mean the checkout flow?") and (b) seed route ranking on a new project. The classifier never sees
// its words either: it only turns an unknown word into a suggestion that a person confirms.
import fs from 'node:fs';

const FILE = new URL('./lexicon.json', import.meta.url);
/** @type {{v: number, version: string, roles: string[], entries: {word: string, synonyms: string[], role: string, object: string}[]}} */
export const LEXICON = Object.freeze(JSON.parse(fs.readFileSync(FILE, 'utf8')));

const singular = (w) => (w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

/**
 * Throws unless the lexicon is well formed: unique words, closed roles, catalog objects, and no synonym that is another
 * entry's word.
 * @param {typeof LEXICON} lx
 * @param {string[]} objects The intent catalog's structural objects.
 * @returns {void}
 */
export function assertLexicon(lx, objects) {
  const words = new Set();
  for (const e of lx.entries) {
    if (!/^[a-z][a-z0-9 -]*$/.test(e.word)) throw new TypeError(`lexicon word "${e.word}" must be lowercase words`);
    if (words.has(e.word)) throw new TypeError(`lexicon word "${e.word}" appears twice`);
    words.add(e.word);
    if (!lx.roles.includes(e.role)) throw new TypeError(`lexicon role "${e.role}" of "${e.word}" is not a closed role`);
    if (!objects.includes(e.object)) throw new TypeError(`lexicon object "${e.object}" of "${e.word}" is not a catalog object`);
  }
  for (const e of lx.entries) for (const s of e.synonyms) if (s !== e.word && words.has(s)) throw new TypeError(`lexicon synonym "${s}" of "${e.word}" is itself a lexicon word`);
}

/**
 * The lexicon entry a word belongs to (as the word or a synonym), or null.
 * @param {string} word
 * @returns {{word: string, synonyms: string[], role: string, object: string}|null}
 */
export function lexiconEntry(word) {
  const w = String(word).toLowerCase();
  return LEXICON.entries.find((e) => e.word === w || e.word === singular(w)) ?? LEXICON.entries.find((e) => e.synonyms.includes(w) || e.synonyms.includes(singular(w))) ?? null;
}

/**
 * Suggest a project map entry for an unmatched word through the lexicon: the word's lexicon family (word plus synonyms)
 * names something in the project ("basket" -> cart -> the project's cart feature). Null when it does not.
 * @param {string} word
 * @param {import('./domainMap.mjs').DomainMap} map
 * @returns {string|null} A map entry key.
 */
export function suggestFromLexicon(word, map) {
  const e = lexiconEntry(word);
  if (!e) return null;
  const family = new Set([e.word, ...e.synonyms].flatMap((x) => [x, singular(x), x.replace(/\s+/g, '')]));
  const order = { feature: 0, item: 1, library: 2, variable: 3, prop: 4 };
  const hits = map.entries.filter((m) => m.forms.some((f) => family.has(f))).sort((a, b) => order[a.type] - order[b.type] || a.key.localeCompare(b.key));
  return hits[0]?.key ?? null;
}
