// #903 (part of #900): NLP arms that read a request into candidate Readings (contract.mjs), recall-first and small.
// Static classify() is the default; every other arm runs in SHADOW behind its own step switch (packages/core/
// ai-profiles.json, off, measured null), and is only used once eval-intent shows it beating static on held-out rows.
//
//   static  drafter classify() -> toReadings (its intent + alternatives)                             always on
//   lr, nb  scikit-learn logistic regression / naive Bayes on the normalized request (no names)       sidecar arm
//   spacy   dependency parse (EntityRuler from the domain map merges names first): verb -> object ->
//           modifiers re-ordered, fed to classify(); a destination preposition picks the target      sidecar parse
//   jev     open-jev's full distribution per closed question (serve.py /choose), epistemic gate       sidecar (jev)
//   nli     zero-shot entailment over the closed labels (small MIT NLI model)                         sidecar arm
//
// One sidecar (trace/tools/jev/serve.py, POST /choose with "arm"), one closed-choice endpoint. Arms never throw: an arm
// that is down, slow or broken answers null and the others stand. Arms disagreeing on a label, or a reading under the
// gate, is a FORK (both values kept for the beam), never a guess.
import { toReadings, assertReading } from './contract.mjs';
import { classify } from '../../../packages/engine/line/drafter/classify.mjs';
import { jevQuestions } from '../../../packages/engine/line/drafter/classifyJev.mjs';
import { VERBS, OBJECTS, LAYERS, intentPhrase } from '../../../packages/engine/line/drafter/contract.mjs';
import { ARM_STEPS } from '../../../packages/engine/line/drafter/shadow.mjs';

export { ARM_STEPS };
/** Every arm, static first (the default). */
export const ARMS = Object.freeze(['static', 'lr', 'nb', 'spacy', 'jev', 'nli']);
/** A reading (or jev's epistemic confidence) under this is a fork candidate. */
export const GATE = 0.5;
/** Readings per arm (recall-first, small). */
export const K = 4;
/** A layer joins a reading at this probability or above (recall-first). */
export const LAYER_MIN = 0.3;
export const DEFAULT_TIMEOUT_MS = 4000;
const OBJECT_IDS = Object.keys(OBJECTS);
const r3 = (x) => Math.round(x * 1000) / 1000;

/**
 * What every arm reads: the drafter's live normalization (draft() returns it) and the static labels.
 * @typedef {object} ArmContext
 * @property {string} request                   What the person typed (only the nli arm sees it; never logged).
 * @property {{text: string, tokens: {t: string, slot?: string, kind?: string, src?: string[]}[]}} normalized
 * @property {Record<string, any>} slots        Slot shapes (draft().slots).
 * @property {Record<string, any>} [bindings]   Slot -> project value (names: only for the nli arm's hypotheses).
 * @property {{id: string}[]} catalog           buildIntentCatalog.
 * @property {any} labels                       Static classify() Labels (draft().labels).
 * @property {{stamp: string, entries: {key: string, type: string, forms: string[]}[]}} [map]  Domain map (spacy's EntityRuler).
 */

/**
 * The sidecar call: POST <base>/choose. Null on any failure or after the timeout.
 * @param {any} body @param {{post?: (body: any) => Promise<any>, baseUrl?: string, timeoutMs?: number}} [o]
 * @returns {Promise<any>}
 */
export async function sidecar(body, o = {}) {
  try {
    if (o.post) return await o.post(body);
    const base = o.baseUrl || process.env.JEV_URL || 'http://127.0.0.1:8765';
    const r = await fetch(`${base}/choose`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(o.timeoutMs ?? DEFAULT_TIMEOUT_MS) });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/** Slot ids of a request, in order of appearance, once. @param {ArmContext['normalized']} n @returns {string[]} */
export const slotIdsOf = (n) => [...new Set(n.tokens.filter((x) => x.slot).map((x) => /** @type {string} */ (x.slot)))];

const top = (d) => Object.entries(d).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

/**
 * Per-label distributions -> top-k Readings. The intent comes from an intent distribution, or from verb x object
 * restricted to the catalog; the target from the slot distribution ("none" -> null; its best two values); layers are
 * every layer at `layerMin` or above (at least the best one). A reading's confidence is P(intent) x P(target).
 * @param {{intent?: Record<string, number>, verb?: Record<string, number>, object?: Record<string, number>, slot?: Record<string, number>, layers?: Record<string, number>}} d
 * @param {{id: string}[]} catalog @param {{k?: number, layerMin?: number}} [o]
 * @returns {import('./contract.mjs').Reading[]}
 */
export function readingsFromDists(d, catalog, o = {}) {
  const k = o.k ?? K;
  const ids = new Set(catalog.map((e) => e.id));
  /** @type {[string, number][]} */
  let intents = [];
  if (d.intent) intents = Object.entries(d.intent).filter(([id]) => id === 'unknown' || ids.has(id));
  else if (d.verb && d.object) for (const [v, pv] of Object.entries(d.verb)) for (const [ob, po] of Object.entries(d.object)) if (ids.has(`${v}.${ob}`)) intents.push([`${v}.${ob}`, pv * po]);
  const z = intents.reduce((a, [, p]) => a + p, 0);
  intents = top(Object.fromEntries(intents.map(([id, p]) => [id, z ? p / z : 0]))).slice(0, k);
  const slots = d.slot && Object.keys(d.slot).length ? top(d.slot).slice(0, 2).map(([s, p]) => [s === 'none' ? null : s, p]) : [[null, 1]];
  const lay = top(d.layers ?? {});
  const layers = lay.filter(([, p]) => p >= (o.layerMin ?? LAYER_MIN)).map(([l]) => l);
  if (!layers.length && lay.length) layers.push(lay[0][0]);
  /** @type {import('./contract.mjs').Reading[]} */
  const out = [];
  for (const [id, pi] of intents) for (const [s, ps] of slots) out.push({ intent: id, object: id === 'unknown' ? null : id.split('.')[1], target: /** @type {string|null} */ (s), layers: [...layers], confidence: r3(Math.min(1, Math.max(0, pi * /** @type {number} */ (ps)))) });
  return out.sort((a, b) => b.confidence - a.confidence).slice(0, k);
}

/** answers [{key, probabilities}] -> {key: {option: p}} @param {any} res */
const distsOf = (res) => Object.fromEntries((res?.answers ?? []).map((a) => [a.key, a.probabilities ?? {}]));
const layerDists = (by, yes = 'yes') => Object.fromEntries(LAYERS.filter((l) => by[`layer:${l}`]).map((l) => [l, Number(by[`layer:${l}`][yes] ?? 0)]));

// ------------------------------------------------------------------------------------------------ the arms

/** static: classify()'s labels as top-k readings (the contract's toReadings). @param {ArmContext} ctx */
export function armStatic(ctx, o = {}) {
  return { readings: toReadings(ctx.labels, { k: o.k ?? K }), confidence: ctx.labels?.intent?.confidence ?? 0 };
}

/**
 * lr / nb: the scikit-learn arms. They see the normalized tokens and slot shapes, never the project's words.
 * @param {'lr'|'nb'} arm @param {ArmContext} ctx @param {any} [o]
 */
export async function armSklearn(arm, ctx, o = {}) {
  const sids = slotIdsOf(ctx.normalized);
  const questions = [{ key: 'intent', options: [...ctx.catalog.map((e) => e.id), 'unknown'] }];
  if (sids.length) questions.push({ key: 'slot', options: [...sids, 'none'] });
  for (const l of LAYERS) questions.push({ key: `layer:${l}`, options: ['yes', 'no'] });
  const read = { tokens: ctx.normalized.tokens.map(({ t, slot, kind }) => (slot ? { t, slot, kind } : { t })), slots: ctx.slots };
  const res = await sidecar({ arm, read, questions }, o);
  if (!res?.answers) return null;
  const by = distsOf(res);
  const readings = readingsFromDists({ intent: by.intent, slot: by.slot, layers: layerDists(by) }, ctx.catalog, o);
  return readings.length ? { readings, confidence: readings[0].confidence, ms: res.ms } : null;
}

const DEST = new Set(['to', 'on', 'onto', 'in', 'into', 'for']);
const DEST_VERBS = new Set(['add', 'base-on', 'wire', 'move', 'promote']);

/**
 * The spaCy parse as a normalized token stream for classify(): the root verb first (lemmatized), then its direct
 * object's subtree, then everything else in order. Each spaCy token maps back to the normalized tokens its words came
 * from, so slots stay slots. Also returns the destination slot (the object of to / on / in / into / for under the root).
 * @param {{i: number, ws: [number, number], lemma: string, pos: string, dep: string, head: number}[]} parse
 * @param {number[]} wordTok  word index -> normalized token index
 * @param {ArmContext['normalized']} n
 */
export function streamFromParse(parse, wordTok, n) {
  const toksOf = (p) => [...new Set(wordTok.slice(p.ws[0], p.ws[1]))];
  const root = parse.find((p) => p.dep === 'ROOT') ?? parse[0];
  if (!root) return { tokens: n.tokens, dest: null };
  const kids = (h) => parse.filter((p) => p.head === h.i && p.i !== h.i);
  const subtree = (h) => { const out = [h]; for (const c of kids(h)) out.push(...subtree(c)); return out.sort((a, b) => a.i - b.i); };
  const obj = kids(root).filter((p) => ['dobj', 'obj', 'attr', 'oprd', 'dative', 'nsubjpass'].includes(p.dep));
  const order = [root, ...obj.flatMap(subtree), ...parse];
  const seen = new Set();
  const tokens = [];
  for (const p of order) {
    for (const ti of toksOf(p)) {
      if (seen.has(ti) || !n.tokens[ti]) continue;
      seen.add(ti);
      const tk = n.tokens[ti];
      tokens.push(p === root && !tk.slot && /^[a-z-]+$/.test(root.lemma) ? { ...tk, t: root.lemma } : tk);
    }
  }
  let dest = null;
  for (const prep of kids(root).filter((p) => p.dep === 'prep' && DEST.has(n.tokens[toksOf(p)[0]]?.t ?? ''))) {
    for (const pobj of kids(prep).filter((p) => p.dep === 'pobj')) {
      const s = toksOf(pobj).map((ti) => n.tokens[ti]).find((t) => t?.slot);
      if (s) { dest = s.slot; break; }
    }
    if (dest) break;
  }
  return { tokens, dest };
}

/** spacy: parse in the sidecar, re-ordered stream into classify(). @param {ArmContext} ctx @param {any} [o] */
export async function armSpacy(ctx, o = {}) {
  const words = []; const wordTok = [];
  ctx.normalized.tokens.forEach((t, i) => { for (const w of t.src?.length ? t.src : [t.t]) { words.push(String(w)); wordTok.push(i); } });
  const patterns = (ctx.map?.entries ?? []).flatMap((e) => e.forms.map((f) => ({ label: e.type.toUpperCase(), pattern: f, id: e.key })));
  const res = await sidecar({ arm: 'spacy', words, patterns, stamp: ctx.map?.stamp ?? null }, o);
  if (!Array.isArray(res?.parse)) return null;
  const { tokens, dest } = streamFromParse(res.parse, wordTok, ctx.normalized);
  const labels = classify({ text: ctx.normalized.text, tokens }, ctx.slots, /** @type {any} */ (ctx.catalog));
  const verb = labels.intent.id.split('.')[0];
  const kind = dest ? ctx.slots[dest]?.kind : null;
  if (dest && DEST_VERBS.has(verb) && (kind === 'feature' || kind === 'page')) labels.target = dest;
  const readings = toReadings(labels, { k: o.k ?? K });
  return { readings, confidence: labels.intent.confidence, ms: res.ms };
}

/** jev: the same closed questions classifyJev asks, with the full distribution kept. @param {ArmContext} ctx @param {any} [o] */
export async function armJev(ctx, o = {}) {
  const qs = jevQuestions(ctx.normalized, ctx.slots);
  const num = (opts) => opts.map((x, i) => `${i + 1}) ${x}`);
  const res = await sidecar({ state: { part: qs.part, facts: qs.facts }, questions: qs.questions.map((q) => ({ key: q.key, text: q.question, options: num(q.options) })) }, o);
  if (!res?.answers) return null;
  const raw = distsOf(res);
  const back = (key, values) => { const q = qs.questions.find((x) => x.key === key); if (!q || !raw[key]) return undefined; const nums = num(q.options); return Object.fromEntries(values.map((v, i) => [v, Number(raw[key][nums[i]] ?? 0)])); };
  const verb = back('verb', [...VERBS]);
  const object = back('object', OBJECT_IDS);
  const slot = qs.slotIds.length ? back('slot', [...qs.slotIds, 'none']) : undefined;
  const layers = Object.fromEntries(LAYERS.map((l) => { const q = qs.questions.find((x) => x.key === `layer:${l}`); return [l, Number(raw[`layer:${l}`]?.[num(q?.options ?? ['yes'])[0]] ?? 0)]; }));
  const readings = readingsFromDists({ verb, object, slot, layers }, ctx.catalog, o);
  // jev's own epistemic confidence (the gate the provider uses), the least sure of its answers.
  const epistemic = Math.min(...(res.answers ?? []).map((a) => Number(a.confidence ?? 0)));
  return readings.length ? { readings, confidence: r3(Number.isFinite(epistemic) ? epistemic : 0), ms: res.ms } : null;
}

const VERB_HYP = Object.freeze({
  add: 'The request asks to add something new.', update: 'The request asks to change something that exists.', remove: 'The request asks to remove something.',
  rename: 'The request asks to rename something.', move: 'The request asks to move something somewhere else.', promote: 'The request asks to move something into the shared library.',
  'base-on': 'The request asks to base something on a shared library item.', wire: 'The request asks to wire or connect something.', split: 'The request asks to split something in two.',
  merge: 'The request asks to merge or combine things.', fix: 'The request asks to fix a problem or error.',
});
const LAYER_HYP = Object.freeze({
  ui: 'It changes what is shown on screen: a page or a component.', workflow: 'It changes a workflow, its steps or its logic.', data: 'It changes data, sample data or a data type.',
  api: 'It changes a backend service, an API or a fetch.', library: 'It changes something shared in the library.',
});

/** nli: zero-shot entailment, one hypothesis per closed option. @param {ArmContext} ctx @param {any} [o] */
export async function armNli(ctx, o = {}) {
  const sids = slotIdsOf(ctx.normalized);
  const nameOf = (s) => { const v = ctx.bindings?.[s]; return v && typeof v === 'object' ? v.name ?? v.id : v ?? s; };
  const questions = [
    { key: 'verb', options: [...VERBS], hypotheses: VERBS.map((v) => VERB_HYP[v]) },
    { key: 'object', options: OBJECT_IDS, hypotheses: OBJECT_IDS.map((ob) => `The request is about ${intentPhrase(`add.${ob}`).replace(/^Add /, '')}.`) },
    { key: 'layers', multi: true, options: [...LAYERS], hypotheses: LAYERS.map((l) => LAYER_HYP[l]) },
  ];
  if (sids.length) questions.push({ key: 'slot', options: [...sids, 'none'], hypotheses: [...sids.map((s) => `The request is about the ${ctx.slots[s]?.kind ?? 'item'} ${nameOf(s)}.`), 'The request does not name anything in the project.'] });
  const res = await sidecar({ arm: 'nli', premise: ctx.request, questions }, o);
  if (!res?.answers) return null;
  const by = distsOf(res);
  const readings = readingsFromDists({ verb: by.verb, object: by.object, slot: by.slot, layers: by.layers }, ctx.catalog, o);
  return readings.length ? { readings, confidence: readings[0].confidence, ms: res.ms } : null;
}

// ------------------------------------------------------------------------------------------------ forks + candidates

/**
 * Forks between arms' best readings: a label where answering arms disagree, or (all agreeing) an arm under the gate
 * (reported once, on the intent: the beam opens that arm's alternatives). Both values are kept; nothing is guessed.
 * @param {Record<string, {readings: any[], confidence: number}|null>} byArm @param {string[]} arms @param {number} [gate]
 * @returns {{label: 'intent'|'object'|'target'|'layers', values: Record<string, any>, reason: 'disagree'|'low-confidence'|'both', low: string[]}[]}
 */
export function armForks(byArm, arms, gate = GATE) {
  const live = arms.filter((a) => byArm[a]?.readings?.length);
  const low = live.filter((a) => /** @type {any} */ (byArm[a]).confidence < gate);
  const out = [];
  for (const label of /** @type {const} */ (['intent', 'object', 'target', 'layers'])) {
    const values = Object.fromEntries(live.map((a) => { const r = /** @type {any} */ (byArm[a]).readings[0]; return [a, label === 'layers' ? [...r.layers].sort() : r[label]]; }));
    const differ = new Set(Object.values(values).map((v) => JSON.stringify(v))).size > 1;
    if (differ) out.push({ label, values, reason: /** @type {const} */ (low.length ? 'both' : 'disagree'), low });
    else if (label === 'intent' && low.length) out.push({ label, values, reason: /** @type {const} */ ('low-confidence'), low });
  }
  return out;
}

/** Union of readings, first arm first, the same closed tuple once (highest confidence kept). @param {any[][]} lists */
export function mergeReadings(lists) {
  const by = new Map();
  for (const list of lists) for (const r of list) {
    const key = JSON.stringify([r.intent, r.target, [...r.layers].sort()]);
    const cur = by.get(key);
    if (!cur) by.set(key, { ...r }); else cur.confidence = Math.max(cur.confidence, r.confidence);
  }
  return [...by.values()];
}

/**
 * Every arm's readings for one request. `readings` are what the beam opens: static's, plus those of arms whose switch
 * is on (`o.on`; none while every arm ships off). `union` and `shadowForks` cover every arm that answered (shadow log,
 * eval). Never throws.
 * @param {ArmContext} ctx
 * @param {{arms?: string[], on?: string[], gate?: number, k?: number, post?: (body: any) => Promise<any>, baseUrl?: string, timeoutMs?: number}} [o]
 */
export async function readCandidates(ctx, o = {}) {
  const arms = (o.arms ?? ARMS).filter((a) => ARMS.includes(a));
  const gate = o.gate ?? GATE;
  const run = { lr: () => armSklearn('lr', ctx, o), nb: () => armSklearn('nb', ctx, o), spacy: () => armSpacy(ctx, o), jev: () => armJev(ctx, o), nli: () => armNli(ctx, o) };
  /** @type {Record<string, any>} */
  const byArm = { static: armStatic(ctx, o) };
  await Promise.all(arms.filter((a) => a !== 'static').map(async (a) => { try { byArm[a] = await run[a](); } catch { byArm[a] = null; } }));
  for (const a of Object.keys(byArm)) if (byArm[a]) { byArm[a].readings = byArm[a].readings.filter((r) => { try { assertReading(r, ctx.catalog); return true; } catch { return false; } }); }
  const answered = ['static', ...arms.filter((a) => a !== 'static' && byArm[a]?.readings?.length)];
  const active = ['static', ...answered.filter((a) => a !== 'static' && (o.on ?? []).includes(a))];
  return {
    readings: mergeReadings(active.map((a) => byArm[a].readings)),
    byArm,
    forks: armForks(byArm, active, gate),
    union: mergeReadings(answered.map((a) => byArm[a].readings)),
    shadowForks: armForks(byArm, answered, gate),
    active,
    gate,
  };
}

/**
 * The shadow record for one request: every arm's readings beside static's, slot form (targets are slot ids; the
 * request is the normalized one), never a project's names.
 * @param {ArmContext} ctx @param {Awaited<ReturnType<typeof readCandidates>>} res
 */
export function armsRecord(ctx, res) {
  return {
    v: /** @type {1} */ (1),
    at: new Date().toISOString(),
    decision: /** @type {'readings'} */ ('readings'),
    request: ctx.normalized.text,
    static: res.byArm.static.readings,
    arms: Object.fromEntries(ARMS.filter((a) => a !== 'static' && a in res.byArm).map((a) => [a, res.byArm[a] ? { readings: res.byArm[a].readings, confidence: res.byArm[a].confidence } : null])),
    forks: res.shadowForks,
    gate: res.gate,
    used: res.active,
  };
}
