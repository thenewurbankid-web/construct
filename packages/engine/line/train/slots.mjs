// Train Line slots: how a stored case's typed slots bind to one world and fill back into text and args. Requests are
// normalized by the System 1 drafter's domain map (../drafter/domainMap.mjs, through draft.mjs), the same map Line
// uses in Cockpit, so a case is stored exactly as the drafter reads a request.
//
// A slotted string names a slot as <form:Name>. The slot's TYPE lives in the case's `slots`; the FORM says how to render it:
//   <feature:F1>  the feature name            <library:L1>  arg: library id, text: its name
//   <item:I1>     arg: feature item id, text: its name     <file:I1> the item's file   <hash:I1> sha256 of that file
//   <name:N1>     a new name ([the name of `from`] + Role + the name of `of`)            <text:T1> a text value      <number:V1> a number
//   <fragment:G1> a code piece's id           <code:C1> new code                       <finding:P1> arg: finding key, text: its file's name
//   <fix:X1>      arg: the fix id, text: its sentence      <missing:M1> a library id or feature that does not exist
import { pascal } from './corpus.mjs';

const SLOT_RE = /<([a-z]+):([A-Z][A-Za-z]*\d+)>/g;
const WHOLE_SLOT_RE = /^<([a-z]+):([A-Z][A-Za-z]*\d+)>$/;
const nameOfId = (id) => String(id).split('/').pop();
const baseName = (file) => String(file).split('/').pop().replace(/\.(tsx|ts|json)$/, '');

export { splitWords } from '../slots.mjs';

/**
 * Resolve every ref of a world's facts that a slot can point at.
 * @param {any} facts
 * @param {string[]} [words] The world's domain words (corpus worlds); texts point at them by "word#i".
 * @returns {Map<string, any>}
 */
export function refTable(facts, words = []) {
  /** @type {Map<string, {type: string, value: any, text: string, file?: string, base?: any, finding?: any}>} */
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
const depth = (slots, name, seen = 0) => {
  const s = slots[name];
  if (!s || seen >= 5) return 0;
  const parents = [s.of, s.from].filter(Boolean);
  return parents.length ? Math.max(...parents.map((x) => 1 + depth(slots, x, seen + 1))) : 0;
};

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
      const from = s.from ? bound[s.from] : null;
      if (s.from && !from) return null;
      const n = `${from ? pascal(from.text) : ''}${s.role ? pascal(s.role) : ''}${of ? pascal(nameOfId(of.arg)) : pascal(s.literal ?? '')}`;
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
