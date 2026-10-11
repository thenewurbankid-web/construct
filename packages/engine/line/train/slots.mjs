// Train Line slots and the domain map.
//
// MIRROR of the drafter agent's domain-normalization contract (buildDomainMap / normalize / denormalize); replace on
// merge. Owner decision (2026-10-11): domain normalization is a static per-project map built from the project's code
// (names split into words -> slots, plus confirmed synonyms), used the same way in training and in use; the model never
// sees domain words. Cases are saved normalized (slotted); the screen denormalizes them for display.
//
// A slotted string names a slot as <form:Name>. The slot's TYPE lives in the case's `slots`; the FORM says how to render it:
//   <feature:F1>  the feature name            <library:L1>  arg: library id, text: its name
//   <item:I1>     arg: feature item id, text: its name     <file:I1> the item's file   <hash:I1> sha256 of that file
//   <name:N1>     a new name (Role + the name of `of`)     <text:T1> a text value      <number:V1> a number
//   <fragment:G1> a code piece's id           <code:C1> new code                       <finding:P1> arg: finding key, text: its file's name
//   <fix:X1>      arg: the fix id, text: its sentence      <missing:M1> a library id or feature that does not exist
import { pascal } from './corpus.mjs';

const SLOT_RE = /<([a-z]+):([A-Z][A-Za-z]*\d+)>/g;
const WHOLE_SLOT_RE = /^<([a-z]+):([A-Z][A-Za-z]*\d+)>$/;
const nameOfId = (id) => String(id).split('/').pop();
const baseName = (file) => String(file).split('/').pop().replace(/\.(tsx|ts|json)$/, '');

/**
 * Split an identifier into lowercase words: "OrderButton" -> ["order", "button"].
 * @param {string} name
 * @returns {string[]}
 */
export function splitWords(name) {
  return String(name).replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w.toLowerCase());
}

/**
 * Resolve every ref of a world's facts that a slot can point at.
 * @param {any} facts
 * @param {string[]} [words] The world's domain words (corpus worlds); texts point at them by "word#i".
 * @returns {Map<string, any>}
 */
export function refTable(facts, words = []) {
  /** @type {Map<string, {type: string, value: any, text: string, file?: string}>} */
  const t = new Map();
  facts.features.forEach((f, i) => {
    t.set(`feature#${i}`, { type: 'feature', value: f.name, text: f.name });
    const byKind = {};
    for (const it of f.items) {
      const j = (byKind[it.kind] = (byKind[it.kind] ?? -1) + 1);
      t.set(`item:feature#${i}/${it.kind}#${j}`, { type: 'item', value: it.id, text: it.name, file: it.file, base: it.base });
    }
  });
  const libByKind = {};
  for (const l of facts.library) {
    const j = (libByKind[l.kind] = (libByKind[l.kind] ?? -1) + 1);
    t.set(`library:${l.kind}#${j}`, { type: 'library', value: l.id, text: l.name });
  }
  facts.findings.forEach((f, i) => t.set(`finding#${i}`, { type: 'finding', value: f.key, text: baseName(f.file), finding: f }));
  words.forEach((w, i) => t.set(`word#${i}`, { type: 'text', value: w, text: w }));
  return t;
}

/**
 * Ref of a value in the table (the reverse lookup), or null.
 * @param {Map<string, any>} table @param {string} type @param {any} value
 * @returns {string|null}
 */
export function refOf(table, type, value) {
  for (const [k, v] of table) if (v.type === type && v.value === value) return k;
  return null;
}

/**
 * Bind a case's slots to one world: each slot's {arg, text} values, or a sentence for the first slot that cannot bind.
 * @param {Record<string, any>} slots
 * @param {any} facts
 * @param {string[]} [words]
 * @returns {{ok: true, bound: Record<string, {arg: any, text: string, file?: string, hash?: string}>} | {ok: false, sentence: string}}
 */
export function bindSlots(slots, facts, words = []) {
  const table = refTable(facts, words);
  /** @type {Record<string, any>} */
  const bound = {};
  const order = Object.keys(slots).sort((a, b) => depth(slots, a) - depth(slots, b));
  for (const name of order) {
    const s = slots[name];
    const r = bindOne(name, s, table, bound, facts);
    if (!r) return { ok: false, sentence: `This world has nothing for ${name} (${s.type}${s.kind ? `, ${s.kind}` : ''}).` };
    bound[name] = r;
  }
  return { ok: true, bound };
}
const depth = (slots, name, seen = 0) => (slots[name]?.of && seen < 5 ? 1 + depth(slots, slots[name].of, seen + 1) : 0);

function bindOne(name, s, table, bound, facts) {
  if (s.literal !== undefined && ['text', 'number', 'name', 'code'].includes(s.type) && !s.of) return { arg: s.literal, text: String(s.literal) };
  switch (s.type) {
    case 'feature': case 'library': case 'item': case 'finding': {
      if (s.of && s.type === 'library') {
        const it = bound[s.of];
        if (!it?.base) return null;
        return { arg: it.base, text: nameOfId(it.base) };
      }
      const v = table.get(s.ref);
      if (!v || v.type !== s.type) return null;
      if (s.type === 'item') return { arg: v.value, text: v.text, file: v.file, hash: facts.files[v.file], base: v.base };
      if (s.type === 'finding') return { arg: v.value, text: v.text, finding: v.finding };
      return { arg: v.value, text: v.text };
    }
    case 'name': {
      const of = s.of ? bound[s.of] : null;
      if (s.of && !of) return null;
      const n = `${s.role ? pascal(s.role) : ''}${of ? pascal(nameOfId(of.arg)) : pascal(s.literal ?? '')}`;
      return n ? { arg: n, text: n } : null;
    }
    case 'text': {
      const v = s.of ? bound[s.of] : table.get(s.ref);
      if (!v) return null;
      const cap = (x) => String(x).charAt(0).toUpperCase() + String(x).slice(1);
      const t = s.role ? `${cap(s.role)} ${v.text}` : cap(v.text);
      return { arg: t, text: t };
    }
    case 'number': return { arg: Number(s.literal), text: String(s.literal) };
    case 'code': {
      const of = s.of ? bound[s.of] : null;
      const said = of ? of.text : String(s.literal ?? '');
      const code = `() => console.log(${JSON.stringify(said)})`;
      return { arg: code, text: `log "${said}"` };
    }
    case 'fragment': {
      const it = bound[s.of];
      const list = it?.file ? facts.fragments?.[it.file] ?? [] : [];
      const i = Number(String(s.ref ?? 'fragment#0').split('#')[1]);
      const g = list[i];
      return g ? { arg: g.id, text: g.label } : null;
    }
    case 'fix': {
      const p = bound[s.of];
      const fx = p?.finding?.fixes?.find((x) => x.rank === s.rank) ?? (s.fixId ? p?.finding?.fixes?.find((x) => x.id.startsWith(s.fixId)) : null);
      return fx ? { arg: fx.id, text: fx.sentence.replace(/[.?!]$/, '') } : null;
    }
    case 'missing': {
      const n = pascal(s.role ?? 'missing');
      if (s.kind === 'feature') return { arg: String(s.role ?? 'missing').toLowerCase(), text: String(s.role ?? 'missing').toLowerCase() };
      const id = `${s.kind}/${n}`;
      return facts.library.some((l) => l.id === id) ? null : { arg: id, text: n };
    }
    default: return null;
  }
}

/** Render one slot reference in an arg (`asArg`) or in text. */
function render(form, v, asArg) {
  if (form === 'file') return v.file;
  if (form === 'hash') return v.hash;
  return asArg ? v.arg : v.text;
}

/**
 * Fill a slotted value (string, array or object) with bound slots. A string that is exactly one slot keeps the slot's
 * type in an arg (a number stays a number).
 * @param {any} value @param {Record<string, any>} bound @param {{asArg?: boolean}} [o]
 * @returns {any}
 */
export function fill(value, bound, o = {}) {
  if (typeof value === 'string') {
    const whole = value.match(WHOLE_SLOT_RE);
    if (whole && o.asArg && bound[whole[2]]) return render(whole[1], bound[whole[2]], true);
    return value.replace(SLOT_RE, (m, form, name) => (bound[name] ? String(render(form, bound[name], Boolean(o.asArg))) : m));
  }
  if (Array.isArray(value)) return value.map((v) => fill(v, bound, o));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, fill(v, bound, o)]));
  return value;
}

// ---------------------------------------------------------------------------------------------- domain map (MIRROR)
const STOP = new Set('a an the and or of in on to for from with into as by at is be it its this that these those my our your their me us make made add put give move change set update fix show use using based base built should can need needs want wants every each all one new own too also so please when then than not no only just more less same other others library feature features page pages component components flow flows workflow workflows item items data sample text value title size code what which who how does do happens asks clicked shared share copy problem problems reported line'.split(' '));
const LETTER = { feature: 'F', library: 'L', item: 'I', name: 'N', text: 'T', number: 'V', fragment: 'G', code: 'C', finding: 'P', fix: 'X', missing: 'M' };

/**
 * MIRROR buildDomainMap: one entry per thing the project names, with its words and the owner's confirmed synonyms.
 * @param {any} facts @param {{words?: string[], synonyms?: Record<string, string>}} [o] `synonyms`: word -> ref.
 * @returns {{entries: {ref: string, type: string, value: any, name: string, words: string[], synonyms: string[]}[]}}
 */
export function buildDomainMap(facts, o = {}) {
  const table = refTable(facts, o.words ?? []);
  const entries = [...table].map(([ref, v]) => ({ ref, type: v.type, value: v.value, name: v.text, words: [...new Set([v.text.toLowerCase(), splitWords(v.text).join(' ')])], synonyms: [] }));
  for (const [word, ref] of Object.entries(o.synonyms ?? {})) entries.find((e) => e.ref === ref)?.synonyms.push(word.toLowerCase());
  return { entries };
}

const edit = (a, b) => {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
};
const plural = (w) => [w, `${w}s`, w.replace(/s$/, '')];

/**
 * MIRROR normalize: replace every name the map knows (and its synonyms) with a typed slot; a new PascalCase name becomes a
 * name slot (Role + a library item when it ends with one); a quoted text a text slot; a number a number slot. Words that
 * look like a known name but are not one come back as `unknown` with closed "Did you mean ...?" choices.
 * @param {string} request @param {{entries: any[]}} map
 * @returns {{request: string, slots: Record<string, any>, unknown: {word: string, choices: {ref: string, name: string}[]}[]}}
 */
export function normalize(request, map) {
  /** @type {Record<string, any>} */
  const slots = {};
  const count = {};
  const slotFor = (type, def) => {
    const existing = Object.entries(slots).find(([, s]) => JSON.stringify(s) === JSON.stringify({ type, ...def }));
    if (existing) return existing[0];
    count[type] = (count[type] ?? 0) + 1;
    const name = `${LETTER[type]}${count[type]}`;
    slots[name] = { type, ...def };
    return name;
  };
  let text = ` ${String(request).trim()} `;
  // quoted texts first: they are values, kept as typed by the owner
  text = text.replace(/"([^"]{1,80})"|“([^”]{1,80})”/g, (m, a, b) => {
    const said = String(a ?? b).trim();
    // "My orders": a role word or two plus a feature's name is stored as {of: that feature, role}, never as the word itself
    for (const e of map.entries.filter((x) => x.type === 'feature')) {
      for (const w of [...e.words, ...e.synonyms]) {
        const m2 = said.match(new RegExp(`^(.*?)\\s*\\b(${plural(w).join('|')})$`, 'i'));
        if (m2 && m2[1].split(/\s+/).filter(Boolean).length <= 2) {
          const F = slotFor('feature', { ref: e.ref });
          return `"<text:${slotFor('text', m2[1].trim() ? { of: F, role: m2[1].trim().toLowerCase() } : { of: F })}>"`;
        }
      }
    }
    return `"<text:${slotFor('text', { literal: said })}>"`;
  });
  // known names, longest phrase first
  const phrases = map.entries.flatMap((e) => [...e.words, ...e.synonyms].map((w) => ({ w, e }))).filter((x) => x.w.length >= 3).sort((a, b) => b.w.length - a.w.length);
  for (const { w, e } of phrases) {
    const re = new RegExp(`(^|[^A-Za-z0-9<:])(${plural(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})(?=[^A-Za-z0-9>]|$)`, 'gi');
    text = text.replace(re, (m, pre) => {
      const form = e.type === 'text' ? 'text' : e.type;
      const def = e.type === 'text' ? { ref: e.ref } : { ref: e.ref, ...(e.type === 'library' ? { kind: String(e.value).split('/')[0] } : {}) };
      return `${pre}<${form}:${slotFor(e.type === 'text' ? 'text' : e.type, def)}>`;
    });
  }
  // a capitalised word that names nothing in the project (not the first word): a library item that does not exist
  text = text.replace(/([^\s][^A-Za-z0-9<:]*\s+)([A-Z][a-z]{2,})(?=[^A-Za-z0-9>]|$)/g, (m, pre, word) => {
    if (STOP.has(word.toLowerCase())) return m;
    return `${pre}<missing:${slotFor('missing', { kind: 'components', role: word.toLowerCase() })}>`;
  });
  // new names: PascalCase words left
  text = text.replace(/(^|[^A-Za-z0-9<:])([A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+)(?=[^A-Za-z0-9>]|$)/g, (m, pre, word) => {
    const lib = map.entries.find((e) => e.type === 'library' && word.endsWith(e.name) && word !== e.name);
    const miss = Object.entries(slots).find(([, x]) => x.type === 'missing' && word.toLowerCase().endsWith(x.role) && word.toLowerCase() !== x.role);
    if (!lib && miss) return `${pre}<name:${slotFor('name', { role: word.slice(0, -miss[1].role.length).toLowerCase(), of: miss[0] })}>`;
    if (lib) {
      const L = slotFor('library', { ref: lib.ref, kind: String(lib.value).split('/')[0] });
      return `${pre}<name:${slotFor('name', { role: word.slice(0, -lib.name.length).toLowerCase(), of: L })}>`;
    }
    return `${pre}<name:${slotFor('name', { role: splitWords(word).join(' ') })}>`;
  });
  text = text.replace(/(^|\s)(\d{1,6})(?=[\s.,!?]|$)/g, (m, pre, n) => `${pre}<number:${slotFor('number', { literal: Number(n) })}>`);
  // unknown words close to a known one
  const known = map.entries.flatMap((e) => [...e.words, ...e.synonyms].map((w) => ({ w, e })));
  const unknown = [];
  for (const word of new Set(text.replace(SLOT_RE, ' ').toLowerCase().match(/[a-z]{4,}/g) ?? [])) {
    if (STOP.has(word)) continue;
    const near = known.map((k) => ({ ...k, d: Math.min(...plural(k.w).map((p) => edit(word, p))) })).filter((k) => k.d > 0 && k.d <= 2).sort((a, b) => a.d - b.d);
    const choices = [...new Map(near.map((k) => [k.e.ref, { ref: k.e.ref, name: k.e.name }])).values()].slice(0, 3);
    if (choices.length) unknown.push({ word, choices });
  }
  return { request: text.trim(), slots, unknown };
}

/**
 * MIRROR denormalize: a slotted text with the names filled back from the world's facts.
 * @param {string} text @param {Record<string, any>} slots @param {any} facts @param {string[]} [words]
 * @returns {string}
 */
export function denormalize(text, slots, facts, words = []) {
  const b = bindSlots(slots, facts, words);
  return b.ok ? fill(text, b.bound) : text;
}
