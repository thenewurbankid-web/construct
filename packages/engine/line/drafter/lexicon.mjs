// The shared, curated general business lexicon shipped with Line (owner 2026-10-11, option B): lexicon.json, static and
// versioned, never built from users' projects. Used only to (a) suggest the slot for an unmatched word as a one-click
// confirm ("Did you mean the checkout flow?") and (b) seed route ranking on a new project. The classifier never sees
// its words either: it only turns an unknown word into a suggestion that a person confirms.
// Its `everyday` part (System 1 accuracy, 2026-10-11) is everyday English that names no project thing: grammar words
// that never become a slot or a question, phrases for a Line library prop or handler ("per page" -> size, "titled" ->
// title), everyday verbs ("needs" -> add, "clear" -> remove) and the handler shapes the templates write (log,
// navigate, call, set). Curated and static like the rest; never built from projects.
// New words reach it only as reviewed rule proposals (cs2, packages/rule-factory): `mergeLexicon` is the one way a
// proposal is added, both when the gate measures it (STATIC_OVERLAY, in the gate's worker only) and when a person applies it.
import fs from 'node:fs';
import { STATIC_OVERLAY } from '../staticOverlay.mjs';

const FILE = new URL('./lexicon.json', import.meta.url);

/**
 * The lexicon with `add` merged in: new entries (a word already there is left as it is), and everyday grammar words,
 * verbs, handler words and phrases added to their lists without duplicates. Pure; `base` is not changed.
 * @param {any} base A lexicon (lexicon.json's shape).
 * @param {import('../staticOverlay.mjs').StaticOverlay['lexicon']} add
 * @returns {any}
 */
export function mergeLexicon(base, add) {
  const out = JSON.parse(JSON.stringify(base));
  if (!add) return out;
  const union = (a = [], b = []) => [...a, ...b.filter((x) => !a.includes(x))];
  for (const e of add.entries ?? []) if (!out.entries.some((x) => x.word === e.word)) out.entries.push({ word: e.word, synonyms: [...(e.synonyms ?? [])], role: e.role, object: e.object });
  const ev = add.everyday;
  if (ev) {
    out.everyday ??= { grammar: [], phrases: [], verbs: {}, handlers: {} };
    out.everyday.grammar = union(out.everyday.grammar, ev.grammar);
    for (const [k, ws] of Object.entries(ev.verbs ?? {})) out.everyday.verbs[k] = union(out.everyday.verbs[k], ws);
    for (const [k, ws] of Object.entries(ev.handlers ?? {})) out.everyday.handlers[k] = union(out.everyday.handlers[k], ws);
    for (const p of ev.phrases ?? []) {
      const same = out.everyday.phrases.find((x) => x.means === p.means);
      if (same) same.say = union(same.say, p.say); else out.everyday.phrases.push({ say: [...p.say], means: p.means });
    }
  }
  return out;
}

const SHIPPED = JSON.parse(fs.readFileSync(FILE, 'utf8'));
/** @type {{v: number, version: string, roles: string[], entries: {word: string, synonyms: string[], role: string, object: string}[], everyday?: {grammar: string[], phrases: {say: string[], means: string}[], verbs: Record<string, string[]>, handlers: Record<string, string[]>}}} */
export const LEXICON = Object.freeze(STATIC_OVERLAY?.lexicon ? mergeLexicon(SHIPPED, STATIC_OVERLAY.lexicon) : SHIPPED);

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
  const ev = lx.everyday;
  if (!ev) return;
  const lower = (w, where) => { if (!/^[a-z][a-z -]*$/.test(w)) throw new TypeError(`everyday ${where} "${w}" must be lowercase words`); };
  for (const w of ev.grammar) lower(w, 'grammar word');
  for (const p of ev.phrases) { lower(p.means, 'phrase meaning'); for (const s of p.say) lower(s, 'phrase'); }
  for (const [verb, ws] of Object.entries(ev.verbs)) { if (!['add', 'remove', 'promote', 'update', 'fix'].includes(verb)) throw new TypeError(`everyday verb "${verb}" is not an intent verb`); for (const w of ws) lower(w, 'verb'); }
  for (const [shape, ws] of Object.entries(ev.handlers)) { if (!HANDLER_SHAPES.includes(shape)) throw new TypeError(`everyday handler "${shape}" is not a handler shape`); for (const w of ws) lower(w, 'handler word'); }
}

/** The handler shapes the static templates write (templates.mjs handlerCode); anything else needs code. */
export const HANDLER_SHAPES = Object.freeze(['log', 'navigate', 'call', 'set']);
const EVERYDAY = LEXICON.everyday ?? { grammar: [], phrases: [], verbs: {}, handlers: {} };

/** Everyday words that name no project thing: never a slot, never a question. */
export const EVERYDAY_GRAMMAR = Object.freeze(new Set(EVERYDAY.grammar));

/**
 * The everyday phrases, longest first: each said form (as lowercase words) and the words it means.
 * @type {readonly {say: string[], means: string[]}[]}
 */
export const EVERYDAY_PHRASES = Object.freeze(EVERYDAY.phrases.flatMap((p) => p.say.map((s) => ({ say: s.split(/\s+/), means: p.means.split(/\s+/) }))).sort((a, b) => b.say.length - a.say.length));

/**
 * The intent verb an everyday verb stands for ("needs" -> add, "clear" -> remove), or null.
 * @param {string} word
 * @returns {string|null}
 */
export function everydayVerb(word) {
  const w = String(word).toLowerCase();
  return Object.entries(EVERYDAY.verbs).find(([, ws]) => ws.includes(w))?.[0] ?? null;
}

/**
 * The handler shape a word asks for ("log" -> log, "navigate" -> navigate), or null.
 * @param {string} word
 * @returns {string|null}
 */
export function handlerShape(word) {
  const w = String(word).toLowerCase();
  return Object.entries(EVERYDAY.handlers).find(([, ws]) => ws.includes(w))?.[0] ?? null;
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
