// Train Line and the real System 1 drafter (../drafter): one domain map, one normalizer, one intent catalog and one
// route drafter, seen in Train Line's case form. Nothing here drafts on its own: a request is normalized by the
// drafter's domain map (../drafter/domainMap.mjs) of the world, drafted by ../drafter/index.mjs in a scratch copy of the
// world (its routes verified by Construct there), and only then rewritten with Train Line's typed slots ("<feature:F1>",
// "<name:N1>" = Role + a library item's name, ...) so a case can be stored without a project or domain word.
import fs from 'node:fs';
import { factsSummary } from '../facts.mjs';
import { buildDomainMap, normalize, FUNCTION_WORDS } from '../drafter/domainMap.mjs';
import { splitWords } from '../slots.mjs';
import { draft as drafterDraft, boundRoute } from '../drafter/index.mjs';
import { TRAIN_TOOLS } from './contract.mjs';
import { materialize, worldKey, pascal } from './corpus.mjs';
import { refTable, refOf } from './slots.mjs';
import { worldFacts } from './generate.mjs';

const LETTER = Object.freeze({ feature: 'F', library: 'L', item: 'I', name: 'N', text: 'T', number: 'V', fragment: 'G', code: 'C', finding: 'P', fix: 'X', missing: 'M' });
const ITEM_LETTERS = 'PCWX';
const DRAFTER_REF = /<([A-Z])(\d+)(?:\.([a-zA-Z][a-zA-Z0-9]*))?>/g;
const WHOLE_DRAFTER_REF = /^<([A-Z])(\d+)(?:\.([a-zA-Z][a-zA-Z0-9]*))?>$/;
const plurals = (w) => [...new Set([w, `${w}s`, w.replace(/s$/, '')])];

/**
 * A world's confirmed synonyms (Train Line keeps them as word -> world ref) as the drafter's (word -> map key).
 * @param {any} world @param {Record<string, string>} [synonyms]
 * @returns {Record<string, string>}
 */
export function drafterSynonyms(world, synonyms = {}) {
  const table = refTable(worldFacts(world));
  /** @type {Record<string, string>} */
  const out = {};
  for (const [word, ref] of Object.entries(synonyms)) {
    const v = table.get(ref);
    if (v && ['feature', 'item', 'library'].includes(v.type)) out[word] = `${v.type}:${v.value}`;
  }
  return out;
}

const mapCache = new Map();
/**
 * The drafter's domain map of a world (built once from a scratch copy, with the world's synonyms).
 * @param {any} world @param {Record<string, string>} [synonyms] Train Line's form (word -> ref).
 * @returns {import('../drafter/domainMap.mjs').DomainMap}
 */
export function worldMap(world, synonyms = {}) {
  const key = `${worldKey(world)}|${JSON.stringify(synonyms)}`;
  if (!mapCache.has(key)) {
    const dir = materialize(world);
    try { mapCache.set(key, buildDomainMap(dir, factsSummary(dir), { synonyms: drafterSynonyms(world, synonyms) })); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
    if (mapCache.size > 200) mapCache.delete(mapCache.keys().next().value);
  }
  return mapCache.get(key);
}

/**
 * Train slots built from the drafter's bindings, one world at a time: each drafter slot ("F1", "C2", "N1", "R1.fix1")
 * becomes a Train slot (or a literal, for a prop name or a page part), the same thing always the same slot.
 * @param {any} facts The world's facts (facts.mjs factsOf).
 * @param {Record<string, any>} [slots] Train slots to add to (kept in place).
 * @returns {{slots: Record<string, any>, add: (type: string, def: object) => string, ref: (slot: string, field: string|undefined, bindings: Record<string, any>) => string|{literal: unknown}|null, convert: (value: any, bindings: Record<string, any>) => any, name: (value: string) => string, text: (value: string) => string, feature: (name: string) => string|null, library: (id: string) => string|null, item: (id: string) => string|null}}
 */
export function createConverter(facts, slots = {}) {
  const table = refTable(facts);
  const add = (type, def) => {
    const hit = Object.entries(slots).find(([, x]) => JSON.stringify(x) === JSON.stringify({ type, ...def }));
    if (hit) return hit[0];
    let n = 1; while (slots[`${LETTER[type]}${n}`]) n++;
    slots[`${LETTER[type]}${n}`] = { type, ...def };
    return `${LETTER[type]}${n}`;
  };
  const feature = (name) => { const r = refOf(table, 'feature', name); return r ? add('feature', { ref: r }) : null; };
  const library = (id) => { const r = refOf(table, 'library', id); return r ? add('library', { ref: r, kind: String(id).split('/')[0] }) : null; };
  const item = (id) => { const r = refOf(table, 'item', id); return r ? add('item', { ref: r, kind: String(id).split('/')[1] }) : null; };
  /** A new name as Train stores it: [a feature's name] + Role + [a library item's, a missing item's or an item's name]. */
  const name = (value) => {
    const v = String(value);
    for (const l of [...facts.library].sort((a, b) => b.name.length - a.name.length)) {
      if (!v.endsWith(l.name) || v === l.name) continue;
      const L = library(l.id);
      const role = v.slice(0, -l.name.length);
      const f = facts.features.find((x) => pascal(x.name) === role);
      if (f) return add('name', { from: feature(f.name), of: L });
      return add('name', { role: splitWords(role).join(' '), of: L });
    }
    for (const [M, s] of Object.entries(slots)) if (s.type === 'missing' && v.toLowerCase().endsWith(s.role) && v.length > s.role.length) return add('name', { role: splitWords(v.slice(0, -s.role.length)).join(' '), of: M });
    const it = facts.features.flatMap((f) => f.items).find((i) => i.name === v);
    if (it) return add('name', { of: item(it.id) });
    return add('name', { role: splitWords(v).join(' ') });
  };
  /** A typed text: "My orders" is {of: the orders feature, role: "my"}, never the word itself. */
  const text = (value) => {
    const said = String(value).trim();
    for (const f of facts.features) {
      for (const w of [f.name, splitWords(f.name).join(' ')]) {
        const m = said.match(new RegExp(`^(.*?)\\s*\\b(${plurals(w).map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})$`, 'i'));
        if (m && m[1].split(/\s+/).filter(Boolean).length <= 2) return add('text', m[1].trim() ? { of: feature(f.name), role: m[1].trim().toLowerCase() } : { of: feature(f.name) });
      }
    }
    return add('text', { literal: said });
  };
  /** The fragment slot of a drafter fragment binding ({id, hash}): the page it is in, and its place there. */
  const fragment = (b) => {
    for (const [file, list] of Object.entries(facts.fragments ?? {})) {
      const i = /** @type {any[]} */ (list).findIndex((g) => g.id === b?.id);
      if (i < 0) continue;
      const it = facts.features.flatMap((f) => f.items).find((x) => x.file === file);
      const I = it ? item(it.id) : null;
      return I ? { I, G: add('fragment', { of: I, ref: `fragment#${i}` }) } : null;
    }
    return null;
  };

  /**
   * One drafter slot ref as Train form ("<feature:F1>") or a literal ({literal}), or null when it cannot be stored.
   * @param {string} slot e.g. "C1" @param {string|undefined} field e.g. "file" @param {Record<string, any>} bindings
   * @returns {string|{literal: unknown}|null}
   */
  function ref(slot, field, bindings) {
    const b = bindings[slot];
    if (b === undefined) return null;
    const L = slot[0];
    if (L === 'F') { const F = feature(typeof b === 'string' ? b : b.name ?? b.id); return F ? `<feature:${F}>` : null; }
    if (ITEM_LETTERS.includes(L)) {
      const I = item(b.id);
      if (!I) return null;
      if (field === 'file') return `<file:${I}>`;
      if (field === 'name') return `<name:${add('name', { of: I })}>`;
      if (field === 'feature') { const F = feature(b.feature); return F ? `<feature:${F}>` : null; }
      if (field === 'kind') return { literal: b.kind };
      // The library item it is based on (a retrieved route builds on it: "<C1.base>").
      if (field === 'base') { const lib = b.base ? library(b.base) : null; return lib ? `<library:${lib}>` : null; }
      return `<item:${I}>`;
    }
    if (L === 'L') { const lib = library(b.id); if (!lib) return null; return field === 'name' ? { literal: b.name } : field === 'kind' ? { literal: b.kind } : `<library:${lib}>`; }
    if (L === 'N') return typeof b === 'string' && b ? `<name:${name(b)}>` : null;
    if (L === 'V') return typeof b === 'number' ? `<number:${add('number', { literal: b })}>` : typeof b === 'string' ? `<text:${text(b)}>` : typeof b === 'boolean' ? { literal: b } : null;
    if (L === 'K') return typeof b === 'string' ? `<code:${add('code', { literal: b })}>` : null;
    if (L === 'R') {
      const i = facts.findings.findIndex((f) => f.key === b.id);
      if (i < 0) return null;
      const P = add('finding', { ref: `finding#${i}` });
      if (!field) return `<finding:${P}>`;
      const n = /^fix(\d+)$/.exec(field);
      const fx = n ? facts.findings[i].fixes[Number(n[1]) - 1] : null;
      return fx ? `<fix:${add('fix', { of: P, rank: fx.rank })}>` : null;
    }
    if (L === 'G') { const g = fragment(b); if (!g) return null; return field === 'hash' ? `<hash:${g.I}>` : `<fragment:${g.G}>`; }
    if (L === 'T') return field === 'nodeId' ? { literal: b.nodeId } : null;
    if (L === 'A' || L === 'S') return { literal: typeof b === 'object' ? b.name ?? b.id : b };
    // A missing feature or library item the request named (Construct refuses it): its kind and its word, as a role.
    if (L === 'M') return `<missing:${add('missing', { kind: b.missing === 'feature' ? 'feature' : b.kind, role: String(b.name).toLowerCase() })}>`;
    return null;
  }

  /**
   * A drafter slot-form value (a step's args, an expression, a label) in Train form; null when a slot cannot be stored.
   * @param {any} value @param {Record<string, any>} bindings
   * @returns {any}
   */
  function convert(value, bindings) {
    if (typeof value === 'string') {
      const whole = WHOLE_DRAFTER_REF.exec(value);
      if (whole) { const r = ref(`${whole[1]}${whole[2]}`, whole[3], bindings); return r === null ? null : typeof r === 'object' ? r.literal : r; }
      let bad = false;
      const out = value.replace(DRAFTER_REF, (m, l, n, f) => { const r = ref(`${l}${n}`, f, bindings); if (r === null) { bad = true; return m; } return typeof r === 'object' ? String(r.literal) : r; });
      return bad ? null : out;
    }
    if (Array.isArray(value)) { const out = value.map((v) => convert(v, bindings)); return out.some((v) => v === null) ? null : out; }
    if (value && typeof value === 'object') {
      const out = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, convert(v, bindings)]));
      return Object.values(out).some((v) => v === null) ? null : out;
    }
    return value;
  }
  return { slots, add, ref, convert, name, text, feature, library, item };
}

/**
 * Rewrite a request with Train slots, from the drafter's normalization: every token the drafter made a slot is replaced
 * where it was typed; a capitalized word that names nothing is a missing item (<missing:M1>); other unknown words stay
 * and come back as "Did you mean ...?" questions with closed choices.
 * @param {string} request The request as typed.
 * @param {{tokens: {t: string, slot?: string, kind?: string, src: string[]}[], bindings: Record<string, any>, questions: any[]}} n The drafter's normalization.
 * @param {any} facts @param {ReturnType<typeof createConverter>} cv @param {import('../drafter/domainMap.mjs').DomainMap} map
 * @returns {{request: string, unknown: {word: string, choices: {ref: string, name: string}[]}[]}}
 */
export function rewriteRequest(request, n, facts, cv, map) {
  const text = String(request);
  // Missing items first, so a new name built on one ("StatusTooltip") can point at it.
  /** @type {Map<object, string>} token -> its missing-item slot */
  const missing = new Map();
  for (const t of n.tokens) {
    if (t.kind === 'missing') { const r = cv.ref(/** @type {string} */ (t.slot), undefined, n.bindings); if (typeof r === 'string') missing.set(t, r.slice('<missing:'.length, -1)); }
    else if (t.kind === 'unknown' && t.src.length === 1 && /^[A-Z][a-z]{2,}$/.test(t.src[0]) && !FUNCTION_WORDS.has(t.src[0].toLowerCase())) missing.set(t, cv.add('missing', { kind: 'components', role: t.src[0].toLowerCase() }));
  }
  /** @type {{s: number, e: number, f: string}[]} */
  const parts = [];
  let cursor = 0;
  const kept = new Set();
  for (const t of n.tokens) {
    let start = -1; let end = cursor;
    for (const piece of t.src) { const i = text.indexOf(piece, end); if (i < 0) { start = -2; break; } if (start === -1) start = i; end = i + piece.length; }
    if (start < 0) continue;
    let form = null;
    if (missing.has(t)) form = `<missing:${missing.get(t)}>`;
    else if (t.kind === 'value' && typeof n.bindings[t.slot] === 'string') { const r = cv.ref(t.slot, undefined, n.bindings); form = r ? `${t.src[0][0]}${r}${t.src[0].at(-1)}` : null; }
    else if (t.kind === 'code') { const r = cv.ref(t.slot, undefined, n.bindings); form = r ? `\`${r}\`` : null; }
    else if (t.slot && t.kind !== 'unknown') { const r = cv.ref(t.slot, undefined, n.bindings); form = typeof r === 'string' ? r : null; }
    if (t.kind === 'unknown' && !missing.has(t)) kept.add(t.slot);
    if (form) parts.push({ s: start, e: end, f: form });
    cursor = end;
  }
  let out = ''; let at = 0;
  for (const { s, e, f } of parts) { out += text.slice(at, s) + f; at = e; }
  out += text.slice(at);
  const table = refTable(facts);
  const byKey = new Map(map.entries.map((e) => [e.key, e]));
  const unknown = n.questions.filter((q) => kept.has(q.slot)).map((q) => ({
    word: q.word,
    choices: q.choices.map((c) => { const e = byKey.get(c.key); const ref = e && ['feature', 'item', 'library'].includes(e.type) ? refOf(table, e.type, e.type === 'feature' ? e.value.name : e.value.id) : null; return ref ? { ref, name: e.value.name } : null; }).filter(Boolean),
  }));
  return { request: out.trim(), unknown };
}

/**
 * Normalize a typed request on one world with the drafter's domain map, in Train form (what a case stores).
 * @param {any} world @param {string} request @param {{synonyms?: Record<string, string>, slots?: Record<string, any>}} [o]
 *   `slots`: a case's slots to add to (the same thing keeps its slot).
 * @returns {{request: string, slots: Record<string, any>, unknown: {word: string, choices: {ref: string, name: string}[]}[]}}
 */
export function normalizeRequest(world, request, o = {}) {
  const map = worldMap(world, o.synonyms);
  const facts = worldFacts(world);
  const cv = createConverter(facts, o.slots ?? {});
  const r = rewriteRequest(request, normalize(String(request), map), facts, cv, map);
  return { request: r.request, slots: cv.slots, unknown: r.unknown };
}

/** The Line kind a bound step works on (Train scope layers are kinds). */
function kindOfStep(step, facts) {
  const a = step.args ?? {};
  if (step.tool === 'line.baseOn') return String(a.libraryId).split('/')[0];
  if (step.tool === 'line.promote') return String(a.featureItemId).split('/')[1];
  if (step.tool === 'line.fix') { const f = facts.findings.find((x) => x.key === a.findingKey); return facts.features.flatMap((x) => x.items).find((i) => i.file === f?.file)?.kind ?? 'components'; }
  return facts.features.flatMap((x) => x.items).find((i) => i.file === a.file)?.kind ?? 'pages';
}

/**
 * One drafted route as a gold route with Train slots, or null when Train Line cannot store it (a tool outside the
 * five, a value or code the request did not give, a name the world cannot bind).
 * @param {any} r A drafter route. @param {any} d The draft. @param {ReturnType<typeof createConverter>} cv @param {any} facts
 * @returns {any}
 */
export function routeOfDraft(r, d, cv, facts) {
  if (!r.steps.every((s) => TRAIN_TOOLS.includes(s.tool)) || r.status === 'needs-model') return null;
  const bindings = r.bindings ?? d.bindings;
  const steps = cv.convert(r.steps, bindings);
  const label = cv.convert(r.label, bindings);
  if (!steps || !label) return null;
  const refused = r.status === 'refused';
  const refusal = refused ? { ...(r.refusal?.code ? { code: r.refusal.code } : {}), ...(r.refusal?.rule ? { rule: r.refusal.rule, fixes: Boolean(r.refusal.fix) } : {}) } : null;
  if (refused && !refusal?.code && !refusal?.rule) return null;
  const expect = refused ? [{ refused: refusal }] : cv.convert(r.expect, bindings);
  if (!expect) return null;
  const bound = boundRoute(d, r.id)?.steps ?? [];
  const features = [...new Set(r.scope.features.map((f) => cv.convert(`<${f}>`, bindings)).filter((x) => typeof x === 'string').map((x) => x.match(/^<feature:([A-Z]\d+)>$/)?.[1]).filter(Boolean))];
  const library = r.scope.scope === 'library' || r.steps.some((s) => s.tool === 'line.promote');
  return {
    id: r.id, label, scope: { layers: [...new Set(bound.map((s) => kindOfStep(s, facts)))], features, library },
    steps, expect, cost: steps.length, risk: library ? 'medium' : 'low', outcome: refused ? 'refusal' : 'change',
    ...(refused ? { refusal } : {}), via: r.via, confidence: r.confidence, status: r.status,
  };
}

/**
 * Draft a request on a world with the real drafter (in a scratch copy of the world; Construct verifies every route
 * there), and the same draft in Train form.
 * @param {any} world @param {string} request
 * @param {{synonyms?: Record<string, string>, records?: any[], maxVerify?: number, verify?: boolean}} [o] `records`: the
 *   drafter's training records retrieval may use (none by default).
 * @returns {{d: any, train: import('./contract.mjs').TrainDraft}}
 */
export function draftInWorld(world, request, o = {}) {
  const dir = materialize(world);
  let d;
  try { d = drafterDraft(dir, String(request), { synonyms: drafterSynonyms(world, o.synonyms), records: o.records ?? [], maxVerify: o.maxVerify, verify: o.verify }); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  const facts = worldFacts(world);
  const cv = createConverter(facts);
  const map = worldMap(world, o.synonyms);
  const rw = rewriteRequest(request, { tokens: d.tokens, bindings: d.bindings, questions: d.questions }, facts, cv, map);
  const routes = d.routes.map((r) => routeOfDraft(r, d, cv, facts)).filter(Boolean);
  const rec = routes.find((r) => r.id === d.recommended) ?? null;
  return {
    d,
    train: {
      request: rw.request, slots: cv.slots, intent: d.labels.intent.id, via: rec?.via ?? 'template', confidence: d.labels.intent.confidence,
      unknown: rw.unknown, routes, recommended: rec?.id ?? null,
    },
  };
}
