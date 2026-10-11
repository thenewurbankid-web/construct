// The per-project domain map (owner 2026-10-11): a STATIC, deterministic map from the project's own words to typed
// slots, used identically in training and use. The model never sees a domain word; it sees "<feature:F1>" and the
// slot's structure (kind, layer, role). The map is rebuilt from the code whenever asked (so a rename updates the map,
// not the model's input shape) and saved inside the project (<state>/domain-map.json, through Construct's writer) with
// the synonyms people confirmed. It is never exported to shared training.
//
// Sources: feature, item, library and prop names; exported names and state variables in feature code (split into
// words, camelCase / kebab / snake); UI label strings, route paths and spec.md story text (weak: they point at the item
// or feature they come from). Resolution of a word in a request: project map -> stored synonym -> shared lexicon
// suggestion (lexicon.mjs) -> local model suggestion (`propose`, optional) -> one closed-choice question.
// For add / rename / create requests an unmatched noun next to a kind word ("a refund page") becomes a NEW name slot.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeLineState } from '../../transactionalWriter.mjs';
import { LineOpError } from '../contract.mjs';
import { KIND_LAYER, REQUEST_SLOT, SLOT_REF } from './contract.mjs';
import { suggestFromLexicon, EVERYDAY_GRAMMAR, EVERYDAY_PHRASES } from './lexicon.mjs';
import { splitWords } from '../slots.mjs';

/** Words that carry function, not domain: kept as they are in the normalized request. */
export const FUNCTION_WORDS = new Set(`a an the this that these those it its them they their our my your his her we you i me us
to of in on at by for from with without into onto inside outside within across over under up down out off about as than then so
and or but not no nor only also too just all any each every both either some more most less few many much other another same
is are be been being was were am do does did done has have had having can could should would will shall may might must need needs
add adds added adding create creates make makes made making new put place insert include build start
update updates change changes changed edit modify set sets setting tweak adjust alter replace swap turn rename call called name named
remove delete drop take get rid clear
move moves moving promote promotes share shared sharing reuse reused reusable reuses library common global everywhere
base based basing on wire wires connect hook link split splits merge merges combine join
fix fixes fixed repair resolve solve correct problem problems issue issues error errors finding findings warning broken wrong
page pages screen screens view views component components widget widgets button buttons card cards part parts element elements
workflow workflows flow flows process step steps state states transition transitions logic handler handlers click clicks clicked when
variable variables value values prop props property properties attribute attributes field fields label text title
service services api apis endpoint endpoints backend server request call calls fetch data fixture fixtures sample samples type types shape shapes model
route routes path url link test tests spec feature features layout folder folders item items thing things
ui front frontend interface design look style styles layer layers code
show shows display displays hide hides list lists use uses using used let lets want wants like please now there here which what where how why
first second third last one two three default empty true false yes off again back next existing current whole
run runs ran ask asks asked go goes open opens opened close closes say says read reads see seen look looks give gives keep keeps happen happens happened
come comes try tries go going should after before instead too very really something someone anything
`.split(/\s+/).filter(Boolean));

/** The part of FUNCTION_WORDS that is grammar: one of these words alone never becomes a slot. */
const GRAMMAR = new Set(`a an the this that these those it its them they their our my your his her we you i me us to of in on at by for from
with without into onto inside outside within across over under up down out off about as than then so and or but not no nor only also too just
all any each every both either some more most less few many much other another same is are be been being was were am do does did done has have
had having can could should would will shall may might must need needs add adds added adding create creates make makes made making new put
place insert include build start update updates change changes changed edit modify set sets setting tweak adjust alter replace swap turn rename
call called name named remove delete drop take get rid clear move moves moving promote promotes share shared sharing reuse reused reusable
reuses library common global everywhere base based basing on wire wires connect hook split splits merge merges combine join fix fixes fixed
repair resolve solve correct problem problems issue issues error errors finding findings page pages screen screens view views component
components part parts element elements workflow workflows flow flows process step steps feature features item items layer layers ui code
show shows display displays hide hides use uses using used let lets want wants please now there here which what where how why first second
third last one two three true false yes again next existing current whole when`.split(/\s+/).filter(Boolean));

const KIND_WORDS = { page: 'pages', pages: 'pages', screen: 'pages', view: 'pages', component: 'components', button: 'components', card: 'components', widget: 'components', workflow: 'workflows', flow: 'workflows', fixture: 'fixtures', feature: 'feature' };
const LETTER = { feature: 'F', pages: 'P', components: 'C', workflows: 'W', fixtures: 'X', library: 'L', prop: 'A', variable: 'S' };
const PRIORITY = { feature: 0, item: 1, library: 2, variable: 3, prop: 4 };
const NEW_VERBS = /^(add|create|make|new|rename|build|start|insert|put|place|call|name|need|needs|want|wants|give|gives)$/;
/** Where an unknown word that nothing resolves names a missing feature or library item (Construct then refuses it). */
const FEATURE_PREP = /^(in|to|for|into|inside)$/;
const LIBRARY_AFTER = /^(based|built|basing|shaped)$/;

export { splitWords } from '../slots.mjs';
const singular = (w) => (w.endsWith('ies') ? `${w.slice(0, -3)}y` : w.endsWith('ses') ? w.slice(0, -2) : w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const plural = (w) => (w.endsWith('y') ? `${w.slice(0, -1)}ies` : w.endsWith('s') ? w : `${w}s`);
/** The surface forms a name is recognised by: "order button", "orderbutton", with the last word singular or plural. */
function formsOf(name) {
  const w = splitWords(name);
  if (!w.length) return [];
  const last = w[w.length - 1];
  const variants = [...new Set([last, singular(last), plural(last)])].map((x) => [...w.slice(0, -1), x]);
  return [...new Set(variants.flatMap((v) => [v.join(' '), v.join('')]))];
}

/**
 * @typedef {{key: string, type: 'feature'|'item'|'library'|'prop'|'variable', value: any, forms: string[]}} MapEntry
 * @typedef {{v: 1, stamp: string, entries: MapEntry[], weak: Record<string, string[]>, synonyms: Record<string, string>}} DomainMap
 */

/** The map file inside the project (Line's state folder). */
const mapFile = (summary) => `${summary.layout.state || 'line'}/domain-map.json`;

/**
 * Build the domain map from the project's code (deterministic). Saved synonyms are merged in when `root` has a map file;
 * a synonym whose target no longer exists is dropped.
 * @param {string} root
 * @param {ReturnType<typeof import('../facts.mjs').factsSummary>} summary
 * @param {{synonyms?: Record<string, string>}} [o]  `synonyms`: more confirmed synonyms (word -> entry key), kept
 *   elsewhere (Train Line keeps an imaginary world's synonyms in its own store).
 * @returns {DomainMap}
 */
export function buildDomainMap(root, summary, o = {}) {
  /** @type {MapEntry[]} */
  const entries = [];
  const add = (key, type, value, name) => { if (!entries.some((e) => e.key === key)) entries.push({ key, type, value, forms: formsOf(name) }); };
  for (const f of summary.features) add(`feature:${f.name}`, 'feature', { id: f.name, name: f.name }, f.name);
  for (const f of summary.features) for (const i of f.items) add(`item:${i.id}`, 'item', { id: i.id, name: i.name, kind: i.kind, feature: f.name, file: i.file, base: i.base }, i.name);
  for (const l of summary.library) add(`library:${l.id}`, 'library', { id: l.id, name: l.name, kind: l.kind, file: l.file }, l.name);
  for (const p of summary.pages) for (const part of p.parts) for (const pr of part.props) add(`prop:${pr.name}`, 'prop', { id: pr.name, name: pr.name }, pr.name);
  for (const f of summary.features) for (const i of f.items) {
    if (i.kind === 'fixtures') continue;
    let src = '';
    try { src = fs.readFileSync(path.join(root, i.file), 'utf8'); } catch { continue; }
    for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function|const|let|type|interface)\s+([A-Za-z_]\w*)|\[\s*([a-z]\w*)\s*,\s*set[A-Z]\w*\s*\]\s*=\s*useState/g)) {
      const n = m[1] ?? m[2];
      if (n && n !== i.name) add(`variable:${i.id}#${n}`, 'variable', { id: n, name: n, item: i.id, feature: f.name }, n);
    }
  }
  /** @type {Record<string, string[]>} weak word -> entry keys (labels, routes, spec text) */
  const weak = {};
  const addWeak = (text, key) => { for (const w of splitWords(text)) if (w.length > 2 && !FUNCTION_WORDS.has(w)) { for (const x of new Set([w, singular(w)])) { weak[x] ??= []; if (!weak[x].includes(key)) weak[x].push(key); } } };
  for (const p of summary.pages) for (const part of p.parts) for (const pr of part.props) if (pr.kind === 'string' && typeof pr.value === 'string') addWeak(pr.value, `item:${p.item}`);
  for (const r of summary.routes) addWeak(r.path, `item:${r.item}`);
  for (const s of summary.specs) addWeak(s.text.replace(/^#.*$/m, ''), `feature:${s.feature}`);
  /** @type {Record<string, string>} */
  let synonyms = {};
  try { synonyms = JSON.parse(fs.readFileSync(path.join(root, mapFile(summary)), 'utf8')).synonyms ?? {}; } catch { /* no saved map yet */ }
  synonyms = { ...synonyms, ...Object.fromEntries(Object.entries(o.synonyms ?? {}).map(([w, k]) => [String(w).toLowerCase(), k])) };
  const keys = new Set(entries.map((e) => e.key));
  synonyms = Object.fromEntries(Object.entries(synonyms).filter(([, k]) => keys.has(k)).sort());
  const stamp = crypto.createHash('sha256').update(JSON.stringify(entries.map((e) => e.key))).digest('hex').slice(0, 12);
  return { v: 1, stamp, entries, weak, synonyms };
}

/**
 * Save the map (with its synonyms) in Line's state folder, through Construct's Line-state writer (writeLineState: temp
 * file + rename; no project copy).
 * @param {string} root
 * @param {ReturnType<typeof import('../facts.mjs').factsSummary>} summary
 * @param {DomainMap} map
 * @returns {string} The root-relative file written.
 */
export function saveDomainMap(root, summary, map) {
  const file = mapFile(summary);
  const text = `${JSON.stringify({ v: 1, stamp: map.stamp, note: 'This project\'s domain map: its own words to slots. It stays in this project and is never shared.', synonyms: map.synonyms, entries: map.entries.map((e) => ({ key: e.key, forms: e.forms })) }, null, 2)}\n`;
  try { writeLineState(root, file, text, { stateDir: summary.layout.state || 'line' }); } catch {
    throw new LineOpError('The domain map could not be saved; nothing was changed.', 'WRITE_FAILED');
  }
  return file;
}

/**
 * Store a confirmed synonym (a person answered "Did you mean ...?") in the project's map, through the writer.
 * @param {string} root
 * @param {ReturnType<typeof import('../facts.mjs').factsSummary>} summary
 * @param {string} word
 * @param {string} key  A map entry key, e.g. "feature:orders".
 * @returns {DomainMap}
 */
export function addSynonym(root, summary, word, key) {
  const map = buildDomainMap(root, summary);
  if (!map.entries.some((e) => e.key === key)) throw new LineOpError(`There is nothing called ${key.split(':').slice(1).join(':')} in this project to link "${word}" to.`, 'UNKNOWN_ITEM');
  const next = { ...map, synonyms: { ...map.synonyms, [String(word).toLowerCase()]: key } };
  saveDomainMap(root, summary, next);
  return next;
}

/** Edit distance (small strings only). */
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

const pascal = (w) => w.charAt(0).toUpperCase() + w.slice(1);

/**
 * Whether the unknown word at tokens[i] stands where a request names its target: a feature ("in archive", "to
 * archive") or a library item ("based on Tooltip", "from Tooltip", "a Carousel called ..."); null elsewhere.
 * @param {{t: string}[]} tokens @param {number} i
 * @returns {'feature'|'library'|null}
 */
function missingRole(tokens, i) {
  const prev = tokens[i - 1]?.t ?? ''; const prev2 = tokens[i - 2]?.t ?? ''; const next = tokens[i + 1]?.t ?? '';
  if ((prev === 'on' && LIBRARY_AFTER.test(prev2)) || prev === 'from' || (prev === 'like' && LIBRARY_AFTER.test(prev2))) return 'library';
  if (/^(a|an)$/.test(prev) && /^(called|named|to|in|for|into)$/.test(next)) return 'library';
  if (FEATURE_PREP.test(prev) && !KIND_WORDS[next]) return 'feature';
  return null;
}
const label = (e) => (e.type === 'feature' ? `the ${e.value.name} feature` : e.type === 'library' ? `the library ${e.value.name}` : e.type === 'item' ? `${e.value.name} in ${e.value.feature}` : e.value.name);

/**
 * Normalize a request: every project word becomes a typed slot. Returns the slotted text (what is stored and what the
 * classifier sees), the bindings (slot -> the project's thing; shown and applied, never stored), the NEW name slots,
 * the questions for unknown words (closed choices, each with how it was suggested) and the ambiguous slots.
 * @param {string} request
 * @param {DomainMap} map
 * @param {{propose?: (word: string, choices: {key: string, label: string}[]) => string|null, lexicon?: boolean}} [o]
 *   `propose`: a local model's guess (an entry key) for an unknown word, shown as a one-click confirm (via "model").
 *   Each token keeps `src`, the words of the request it stands for (as typed), so a caller can rebuild the sentence.
 * @returns {{text: string, tokens: {t: string, slot?: string, kind?: string, src: string[]}[], bindings: Record<string, any>, entries: Record<string, string>, ambiguous: Record<string, string[]>, questions: {slot: string, word: string, sentence: string, choices: {key: string, label: string}[], suggested: string|null, via: 'map'|'lexicon'|'model'|'ask'}[], fully: boolean}}
 */
export function normalize(request, map, o = {}) {
  /** @type {{t: string, slot?: string, kind?: string, raw?: string, src: string[]}[]} */
  const tokens = [];
  /** @type {Record<string, any>} */
  /** @type {Record<string, any>} */
  const bindings = {};
  /** @type {Record<string, string>} slot -> map entry key */
  const entries = {};
  const count = {};
  const slotFor = (letter) => { count[letter] = (count[letter] ?? 0) + 1; return `${letter}${count[letter]}`; };
  const byKey = new Map(map.entries.map((e) => [e.key, e]));
  const keySlot = new Map();
  /** @type {Record<string, string[]>} */
  const ambiguous = {};
  const questions = [];

  // 1. Literals: quoted text and code, numbers, booleans.
  const pieces = String(request).split(/(`[^`]*`|"[^"]*"|“[^”]*”|(?<=^|\s)'[^']*'(?=\s|$|[.,!?]))/);
  for (const piece of pieces) {
    if (!piece) continue;
    if (/^`.*`$/s.test(piece)) { const s = slotFor('K'); bindings[s] = piece.slice(1, -1); tokens.push({ t: `<code:${s}>`, slot: s, kind: 'code', src: [piece] }); continue; }
    if (/^(["“']).*(["”'])$/s.test(piece)) { const s = slotFor('V'); bindings[s] = piece.slice(1, -1); tokens.push({ t: `<value:${s}>`, slot: s, kind: 'value', src: [piece] }); continue; }
    for (const raw of piece.split(/\s+/)) {
      const w = raw.replace(/^[^A-Za-z0-9-]+|[^A-Za-z0-9]+$/g, '');
      if (!w) continue;
      if (/^-?\d+(\.\d+)?$/.test(w)) { const s = slotFor('V'); bindings[s] = Number(w); tokens.push({ t: `<value:${s}>`, slot: s, kind: 'value', src: [w] }); continue; }
      tokens.push({ t: w.toLowerCase(), raw: w, src: [w] });
    }
  }

  // 2. Project names: the longest phrase first (4 words down to 1), then stored synonyms.
  const formIndex = new Map();
  for (const e of map.entries) for (const f of e.forms) { if (!formIndex.has(f)) formIndex.set(f, []); formIndex.get(f).push(e.key); }
  const mentionedFeatures = new Set();
  const pickKey = (keys) => {
    const ranked = [...keys].sort((a, b) => {
      const ea = byKey.get(a); const eb = byKey.get(b);
      const inA = ea.value.feature && mentionedFeatures.has(ea.value.feature) ? 0 : 1;
      const inB = eb.value.feature && mentionedFeatures.has(eb.value.feature) ? 0 : 1;
      return inA - inB || PRIORITY[ea.type] - PRIORITY[eb.type] || a.localeCompare(b);
    });
    return ranked;
  };
  const useEntry = (keys) => {
    const ranked = pickKey(keys);
    const e = byKey.get(ranked[0]);
    if (keySlot.has(e.key)) return keySlot.get(e.key);
    const kind = e.type === 'item' ? e.value.kind : e.type;
    const s = slotFor(LETTER[kind]);
    keySlot.set(e.key, s);
    entries[s] = e.key;
    bindings[s] = e.type === 'feature' ? e.value.name : { ...e.value };
    if (e.type === 'feature') mentionedFeatures.add(e.value.name);
    const alts = ranked.slice(1).filter((k) => byKey.get(k).type === e.type);
    if (alts.length) ambiguous[s] = [e.key, ...alts];
    return s;
  };
  const typeName = (s) => ({ F: 'feature', P: 'page', C: 'component', W: 'workflow', X: 'fixture', L: 'library', A: 'prop', S: 'variable' })[s[0]];
  // Features first so items prefer a mentioned feature.
  for (const pass of ['feature', 'any']) {
    for (let i = 0; i < tokens.length; i++) {
      if (tokens[i].slot) continue;
      for (let n = Math.min(4, tokens.length - i); n >= 1; n--) {
        const span = tokens.slice(i, i + n);
        if (span.some((x) => x.slot)) continue;
        const phrase = span.map((x) => x.t).join(' ');
        let keys = formIndex.get(phrase) ?? (map.synonyms[phrase] ? [map.synonyms[phrase]] : null);
        if (!keys) continue;
        // First pass: a feature only when it is the longest match here ("visits page" is the page, not the feature).
        if (pass === 'feature' && !keys.some((k) => byKey.get(k).type === 'feature')) break;
        if (pass === 'feature') keys = keys.filter((k) => byKey.get(k).type === 'feature');
        // Grammar (verbs, kind words, articles) never names a project thing on its own, unless a person said so (a synonym).
        if (n === 1 && GRAMMAR.has(phrase) && !map.synonyms[phrase]) keys = [];
        if (!keys.length) continue;
        const s = useEntry(keys);
        tokens.splice(i, n, { t: `<${typeName(s)}:${s}>`, slot: s, kind: typeName(s), src: span.flatMap((x) => x.src) });
        break;
      }
    }
  }

  // 2b. Everyday phrases for a library prop or handler ("per page" -> size, "titled" -> title): rewritten, then looked
  //     up in the project map like any phrase (a project without that prop leaves the words as they are).
  for (let i = 0; i < tokens.length; i++) {
    if (tokens[i].slot) continue;
    const p = EVERYDAY_PHRASES.find((x) => x.say.every((w, k) => tokens[i + k] && !tokens[i + k].slot && tokens[i + k].t === w));
    if (!p) continue;
    const span = tokens.slice(i, i + p.say.length);
    const keys = formIndex.get(p.means.join(' ')) ?? formIndex.get(p.means.join(''));
    if (keys) {
      const s = useEntry(keys);
      tokens.splice(i, p.say.length, { t: `<${typeName(s)}:${s}>`, slot: s, kind: typeName(s), src: span.flatMap((x) => x.src) });
    } else {
      tokens.splice(i, p.say.length, ...p.means.map((w, k) => ({ t: w, raw: w, src: k ? [] : span.flatMap((x) => x.src) })));
      i += p.means.length - 1;
    }
  }

  // 3. What is left: function words stay; a noun next to a kind word under an add/rename verb is a NEW name; else unknown.
  const verbFirst = tokens.find((x) => !x.slot && FUNCTION_WORDS.has(x.t))?.t ?? '';
  const creating = NEW_VERBS.test(verbFirst) || tokens.some((x) => /^(called|named)$/.test(x.t));
  for (let i = 0; i < tokens.length; i++) {
    const x = tokens[i];
    if (x.slot || FUNCTION_WORDS.has(x.t) || EVERYDAY_GRAMMAR.has(x.t)) continue;
    const prev = tokens[i - 1]?.t ?? ''; const next = tokens[i + 1]?.t ?? '';
    const kindNext = KIND_WORDS[next]; const kindPrev = KIND_WORDS[prev];
    // "a refund page", "a new waiting room page": an article before the words marks something new; "the X page" is existing.
    if (creating && /^(a|an|new|another)$/.test(prev)) {
      let j = i;
      while (j + 1 < tokens.length && !tokens[j + 1].slot && !FUNCTION_WORDS.has(tokens[j + 1].t)) j++;
      const kindAfter = KIND_WORDS[tokens[j + 1]?.t ?? ''];
      if (kindAfter && j > i) {
        const s = slotFor('N');
        const words = tokens.slice(i, j + 1).map((t) => t.t);
        bindings[s] = kindAfter === 'feature' ? words.join('-') : kindAfter === 'pages' || kindAfter === 'components' ? `${words.map(pascal).join('')}${tokens[j + 1].t !== 'component' ? pascal(tokens[j + 1].t) : ''}` : words.map((w, k) => (k ? pascal(w) : w)).join('');
        tokens.splice(i, j - i + 1, { t: `<new:${s}>`, slot: s, kind: 'new', src: tokens.slice(i, j + 1).flatMap((x) => x.src) });
        continue;
      }
    }
    const article = /^(a|an|new|another)$/.test(prev) || (/^(a|an|another)$/.test(tokens[i - 2]?.t ?? '') && prev === 'new');
    if (/^(called|named)$/.test(prev) || (creating && article && (kindNext || kindPrev))) {
      const s = slotFor('N');
      const kind = /^(called|named)$/.test(prev) ? KIND_WORDS[tokens[i - 2]?.t ?? ''] ?? null : kindNext ?? kindPrev;
      // A name typed as a name ("a FastCheckout flow") is kept as typed.
      bindings[s] = /^(called|named)$/.test(prev) || /^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+$/.test(x.raw ?? '') ? x.raw : kind === 'feature' ? x.t : kind === 'pages' || kind === 'components' ? `${pascal(x.t)}${kindNext && next !== 'component' ? pascal(next) : ''}` : x.t;
      tokens[i] = { t: `<new:${s}>`, slot: s, kind: 'new', src: x.src };
      continue;
    }
    // A name typed as one PascalCase word that names nothing here ("StatusBadge") is a NEW name, kept as typed.
    if (/^[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+$/.test(x.raw ?? '')) {
      const s = slotFor('N');
      bindings[s] = x.raw;
      tokens[i] = { t: `<new:${s}>`, slot: s, kind: 'new', src: x.src };
      continue;
    }
    // A weak source (a label, a route path, spec text) points at one thing: that thing's slot.
    const weak = map.weak[x.t] ?? map.weak[singular(x.t)];
    if (weak && weak.length === 1 && byKey.has(weak[0])) {
      const s = useEntry(weak);
      tokens[i] = { t: `<${typeName(s)}:${s}>`, slot: s, kind: typeName(s), src: x.src };
      continue;
    }
    const near = map.entries.map((e) => ({ e, d: Math.min(...e.forms.map((f) => distance(x.t, f))) })).filter((c) => c.d <= Math.max(1, Math.floor(x.t.length / 4))).sort((a, b) => a.d - b.d || PRIORITY[a.e.type] - PRIORITY[b.e.type]).slice(0, 3);
    let suggested = near[0]?.e.key ?? null; let via = /** @type {'map'|'lexicon'|'model'|'ask'} */ (suggested ? 'map' : 'ask');
    if (!suggested && o.lexicon !== false) { const lx = suggestFromLexicon(x.t, map); if (lx) { suggested = lx; via = 'lexicon'; } }
    // Refusal semantics: a word in a target place ("in archive", "based on Tooltip", "a Carousel called ...") that
    // neither the project map nor the lexicon resolves names a MISSING feature or library item. It is drafted as asked
    // and Construct refuses it with its own sentence; a near miss stays a closed "Did you mean" question.
    const missing = !suggested && creating ? missingRole(tokens, i) : null;
    if (missing) {
      const s = slotFor('M');
      const raw = x.raw ?? x.t;
      const kind = missing === 'library' ? KIND_WORDS[next] ?? KIND_WORDS[prev] ?? 'components' : 'feature';
      const name = missing === 'feature' ? x.t : kind === 'fixtures' || kind === 'workflows' ? raw : pascal(raw);
      bindings[s] = missing === 'feature' ? { id: name, name, missing: 'feature' } : { id: `${kind}/${name}`, name, kind: kind === 'feature' ? 'components' : kind, missing: 'library' };
      tokens[i] = { t: `<missing:${s}>`, slot: s, kind: 'missing', src: x.src };
      continue;
    }
    const s = slotFor('U');
    bindings[s] = x.t;
    tokens[i] = { t: `<unknown:${s}>`, slot: s, kind: 'unknown', src: x.src };
    const choiceKeys = [...new Set([...(suggested ? [suggested] : []), ...near.map((c) => c.e.key), ...map.entries.filter((e) => e.type === 'feature').map((e) => e.key)])].slice(0, 4);
    if (!suggested && o.propose) { const m = o.propose(x.t, choiceKeys.map((k) => ({ key: k, label: label(byKey.get(k)) }))); if (m && byKey.has(m)) { suggested = m; via = 'model'; } }
    const choices = choiceKeys.filter((k) => byKey.has(k)).map((k) => ({ key: k, label: label(byKey.get(k)) }));
    questions.push({ slot: s, word: x.t, sentence: suggested ? `Did you mean ${label(byKey.get(suggested))} by "${x.t}"?` : `Which part of the project do you mean by "${x.t}"?`, choices, suggested, via });
  }
  return { text: tokens.map((x) => x.t).join(' '), tokens: tokens.map(({ t, slot, kind, src }) => ({ t, ...(slot ? { slot, kind } : {}), src })), bindings, entries, ambiguous, questions, fully: questions.length === 0 };
}

/**
 * Fill a normalized text's slots back with the project's names (for display only).
 * @param {string} text
 * @param {Record<string, any>} bindings
 * @returns {string}
 */
export function denormalize(text, bindings) {
  return String(text).replace(REQUEST_SLOT, (m, _k, s) => {
    const b = bindings[s];
    if (b === undefined) return m;
    if (b && typeof b === 'object') return b.name ?? b.id;
    return typeof b === 'string' && /^[VK]/.test(s) ? `"${b}"` : String(b);
  });
}

/**
 * The structure of each slot (what is stored): kinds, layers and roles, never names.
 * @param {Record<string, any>} bindings
 * @param {Record<string, string>} entryOf  slot -> map entry key
 * @param {{features: {name: string, items: {id: string, kind: string}[]}[]}} summary
 * @param {Map<string, string>} roles  node id -> role (../structure.mjs rolesOf)
 * @returns {Record<string, import('./contract.mjs').SlotShape>}
 */
export function slotShapes(bindings, entryOf, summary, roles) {
  /** @type {Record<string, any>} */
  const out = {};
  const featureSlot = Object.fromEntries(Object.entries(bindings).filter(([s]) => s[0] === 'F').map(([s, v]) => [v, s]));
  for (const [s, b] of Object.entries(bindings)) {
    const L = s[0];
    if (L === 'F') {
      const f = summary.features.find((x) => x.name === b);
      const items = f?.items ?? [];
      const counts = {};
      for (const i of items) counts[i.kind] = (counts[i.kind] ?? 0) + 1;
      out[s] = { kind: 'feature', layers: [...new Set(items.map((i) => KIND_LAYER[i.kind]))].sort(), roles: [...new Set(items.map((i) => roles.get(i.id)).filter(Boolean))].sort(), counts };
    } else if ('PCWX'.includes(L)) out[s] = { kind: { P: 'page', C: 'component', W: 'workflow', X: 'fixture' }[L], area: 'feature', itemKind: b.kind, layer: KIND_LAYER[b.kind], role: roles.get(b.id) ?? 'unbased', ...(featureSlot[b.feature] ? { of: featureSlot[b.feature] } : {}) };
    else if (L === 'L') out[s] = { kind: 'library', area: 'library', itemKind: b.kind, layer: 'library', role: roles.get(b.id) ?? 'atom' };
    else if (L === 'A') out[s] = { kind: 'prop', ...(/^on[A-Z]/.test(String(b?.name ?? '')) ? { handler: true } : {}) };
    else if (L === 'S') out[s] = { kind: 'variable', ...(featureSlot[b.feature] ? { of: featureSlot[b.feature] } : {}) };
    else if (L === 'V') out[s] = { kind: 'value', valueType: typeof b };
    else if (L === 'N') out[s] = { kind: 'new', isNew: true };
    else if (L === 'K') out[s] = { kind: 'code' };
    else if (L === 'U') out[s] = { kind: 'unknown' };
    else if (L === 'M') out[s] = { kind: 'missing', of: b.missing, ...(b.kind ? { itemKind: b.kind } : {}) };
    else out[s] = { kind: ({ R: 'problem', T: 'part', G: 'fragment' })[L] ?? 'other' };
    void entryOf;
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ slot binding
// Stored forms (route steps, expressions, deltas) hold slot refs (<F1>, <C1.file>, components/<C1.name>); bind() fills
// the project's names only to show or apply a route, never to store it.

/**
 * Replace slot refs in every string of a value with their bindings. A string that is exactly one ref takes the bound
 * value as it is (a number stays a number); a ref inside a longer string is spliced in as text.
 * @template T
 * @param {T} value
 * @param {Record<string, any>} bindings  Slot id -> value or {field: value}.
 * @returns {T}
 */
export function bind(value, bindings) {
  const look = (letter, n, field) => {
    const b = bindings[`${letter}${n}`];
    if (b === undefined) return undefined;
    if (field) return b && typeof b === 'object' ? b[field] : undefined;
    return b && typeof b === 'object' && 'id' in b ? b.id : b;
  };
  if (typeof value === 'string') {
    const whole = /^<([A-Z])(\d+)(?:\.([a-zA-Z][a-zA-Z0-9]*))?>$/.exec(value);
    if (whole) { const v = look(whole[1], whole[2], whole[3]); return /** @type {any} */ (v === undefined ? value : v); }
    return /** @type {any} */ (value.replace(SLOT_REF, (m, l, n, f) => { const v = look(l, n, f); return v === undefined ? m : String(v); }));
  }
  if (Array.isArray(value)) return /** @type {any} */ (value.map((v) => bind(v, bindings)));
  if (value && typeof value === 'object') return /** @type {any} */ (Object.fromEntries(Object.entries(value).map(([k, v]) => [k, bind(v, bindings)])));
  return value;
}

/**
 * Whether a value still holds an unbound slot ref.
 * @param {unknown} value
 * @returns {boolean}
 */
export function hasSlots(value) {
  return /<[A-Z]\d+(?:\.[a-zA-Z][a-zA-Z0-9]*)?>/.test(JSON.stringify(value));
}
