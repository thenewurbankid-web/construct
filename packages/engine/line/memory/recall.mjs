// j5 -- recall over slotted decision records (never code): exact match on step + intent + structure, then similarity
// over SLOT and STRUCTURE features only: slot overlap, structure-neighbourhood Jaccard and BM25 over the slot tokens.
// Pure functions; the store (store.mjs) reads the records and the optional embeddings (embed.mjs) add one more score.
import { FOR_CHOSEN, AGAINST_PROPOSED, MIN_CONSISTENT } from './contract.mjs';

/** @typedef {import('./contract.mjs').MemoryRecord} MemoryRecord */
/** @typedef {import('./contract.mjs').Recalled} Recalled */
/** @typedef {{intent: string, structure?: string|null, slots?: string[], neighbourhood?: string[]}} RecallContext */

const set = (xs) => new Set(xs ?? []);
/**
 * Jaccard of two lists (1 when both are empty and equal).
 * @param {string[]|undefined} a @param {string[]|undefined} b
 * @returns {number}
 */
export function jaccard(a, b) {
  const x = set(a); const y = set(b);
  if (!x.size && !y.size) return 0;
  let inter = 0;
  for (const t of x) if (y.has(t)) inter += 1;
  return inter / (x.size + y.size - inter);
}

/**
 * The tokens BM25 reads from a record or a query: the intent's parts and every slot and neighbourhood token's words.
 * @param {{intent: string, slots?: string[], neighbourhood?: string[]}} x
 * @returns {string[]}
 */
export function slotTokens(x) {
  const parts = [...String(x.intent ?? '').split(/[.:\s]+/), ...(x.slots ?? []).flatMap((s) => String(s).split(/[\s:=]+/)), ...(x.neighbourhood ?? []).flatMap((s) => String(s).split(/[\s:=]+/))];
  return parts.map((t) => t.toLowerCase()).filter(Boolean);
}

/**
 * BM25 scores of every document for a query (k1 1.2, b 0.75), normalized to 0..1 by the best one.
 * @param {string[][]} docs @param {string[]} query
 * @returns {number[]}
 */
export function bm25(docs, query) {
  const n = docs.length;
  if (!n) return [];
  const avg = docs.reduce((s, d) => s + d.length, 0) / n || 1;
  const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) ?? 0) + 1);
  const q = [...new Set(query)];
  const raw = docs.map((d) => {
    const tf = new Map();
    for (const t of d) tf.set(t, (tf.get(t) ?? 0) + 1);
    let s = 0;
    for (const t of q) {
      const f = tf.get(t) ?? 0;
      if (!f) continue;
      const idf = Math.log(1 + (n - (df.get(t) ?? 0) + 0.5) / ((df.get(t) ?? 0) + 0.5));
      s += idf * ((f * 2.2) / (f + 1.2 * (1 - 0.75 + (0.75 * d.length) / avg)));
    }
    return s;
  });
  const max = Math.max(...raw);
  return raw.map((s) => (max > 0 ? s / max : 0));
}

/** Weights of the non-neural similarity (sum 1). */
export const WEIGHTS = Object.freeze({ intent: 0.3, slots: 0.25, neighbourhood: 0.2, bm25: 0.25 });
/** Below this a similar record is not recalled. */
export const MIN_SIMILAR = 0.45;

/**
 * Recall: exact matches first (same step, intent and structure; newest first), then similar records of the same step
 * (score >= MIN_SIMILAR), best first. `extra` adds one more similarity per record (embeddings), weighted 0.5.
 * @param {MemoryRecord[]} records The step's records, in file order (oldest first).
 * @param {string} step
 * @param {RecallContext} ctx
 * @param {number} [k]
 * @param {{extra?: (number|null)[], minSimilar?: number}} [o]
 * @returns {(Recalled & {i: number})[]}
 */
export function recallFrom(records, step, ctx, k = 5, o = {}) {
  const mine = records.map((record, i) => ({ record, i })).filter((x) => x.record.step === step);
  const exact = mine.filter((x) => x.record.intent === ctx.intent && ctx.structure && x.record.structure === ctx.structure)
    .sort((a, b) => b.i - a.i).map((x) => ({ ...x, score: 1, how: /** @type {const} */ ('exact') }));
  const taken = new Set(exact.map((x) => x.i));
  const rest = mine.filter((x) => !taken.has(x.i));
  const b = bm25(rest.map((x) => slotTokens(x.record)), slotTokens(ctx));
  const similar = rest.map((x, j) => {
    const base = (x.record.intent === ctx.intent ? WEIGHTS.intent : 0) + WEIGHTS.slots * jaccard(x.record.slots, ctx.slots)
      + WEIGHTS.neighbourhood * jaccard(x.record.neighbourhood, ctx.neighbourhood) + WEIGHTS.bm25 * b[j];
    const e = o.extra?.[x.i];
    const score = typeof e === 'number' ? 0.5 * base + 0.5 * e : base;
    return { ...x, score: Math.round(score * 1000) / 1000, how: /** @type {'similar'|'embedding'} */ (typeof e === 'number' ? 'embedding' : 'similar') };
  }).filter((x) => x.score >= (o.minSimilar ?? MIN_SIMILAR)).sort((a, c) => c.score - a.score || c.i - a.i);
  return [...exact, ...similar].slice(0, Math.max(0, k));
}

/**
 * The option the recalled PERSON decisions consistently chose, among the options offered now: the newest `min`
 * person decisions that touch these options all chose it (a later refusal, skip or disagreement of it breaks the run).
 * Agents' and Line's own records are remembered but never steer the ranking.
 * @param {(Recalled & {i?: number})[]} recalled
 * @param {string[]} optionIds The option keys offered now (already checked by Construct).
 * @param {{min?: number, labelOf?: (id: string) => string}} [o]
 * @returns {import('./contract.mjs').MemoryPreference|null}
 */
export function preferenceOf(recalled, optionIds, o = {}) {
  const min = o.min ?? MIN_CONSISTENT;
  const offered = new Set(optionIds);
  const newestFirst = [...recalled].sort((a, b) => (b.i ?? 0) - (a.i ?? 0) || Date.parse(b.record.at) - Date.parse(a.record.at));
  const votes = [];
  for (const { record: r } of newestFirst) {
    if (r.by !== 'person') continue;
    if (FOR_CHOSEN.includes(r.kind) && r.chosen && offered.has(r.chosen)) votes.push({ for: r.chosen });
    else if (AGAINST_PROPOSED.includes(r.kind) && r.proposed && offered.has(r.proposed)) votes.push({ against: r.proposed });
  }
  const first = votes[0]?.for;
  if (!first) return null;
  let count = 0;
  for (const v of votes) { if (v.for === first) count += 1; else break; }
  if (count < min) return null;
  const label = o.labelOf ? o.labelOf(first) : first;
  return { option: first, count, of: votes.length, sentence: `Recalled from ${count} past decisions: the last ${count} times you picked ${label}.` };
}

/**
 * A read-only memory over records already in hand (evals and tests): the same recall and preference as the store,
 * nothing read or written.
 * @param {MemoryRecord[]} records
 * @returns {{recall: (step: string, ctx: RecallContext, k?: number) => (Recalled & {i: number})[], prefer: (step: string, ctx: RecallContext, ids: string[], o?: {labelOf?: (id: string) => string, k?: number}) => import('./contract.mjs').MemoryPreference|null}}
 */
export function memoryOver(records) {
  const recall = (step, ctx, k = 5) => recallFrom(records, step, ctx, k);
  return { recall, prefer: (step, ctx, ids, o = {}) => preferenceOf(recall(step, ctx, o.k ?? 10), ids, { labelOf: o.labelOf }) };
}
