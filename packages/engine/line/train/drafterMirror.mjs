// MIRROR of the drafter contract (another agent builds the real System 1 drafter: draft(request, facts) -> {routes:
// [{id, label, scope, steps, expect, cost, risk, via, confidence}], recommended}). Replace on merge; keep the call shape.
//
// This mirror is deliberately simple and static, so Train Line has something real to score:
//   1. normalize the request through the world's domain map (slots.mjs): names become typed slots;
//   2. retrieval: the stored TRAIN case whose slotted wording is nearest (word overlap) gives the intent and its gold
//      routes; the request's slots are aligned to the case's by type and order of appearance;
//   3. template: with no near case, a keyword rule picks the intent and the routes come from its catalog wording.
import { INTENTS } from './contract.mjs';
import { INTENT_DEFS, goldFor } from './routes.mjs';
import { normalize, bindSlots, refTable } from './slots.mjs';

const SLOT_RE = /<([a-z]+):([A-Z][A-Za-z]*\d+)>/g;
const tokens = (slotted) => new Set(String(slotted).replace(SLOT_RE, (m, form) => ` slot${form} `).toLowerCase().match(/[a-z]+/g) ?? []);
const jaccard = (a, b) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n || 1); };
const order = (slotted) => [...String(slotted).matchAll(SLOT_RE)].map((m) => m[2]);

/** Keyword rules: the template fallback's intent for a slotted request. */
const RULES = [
  [/\bfix|problem|not allowed|no base\b/, 'fix.problem'],
  [/\bshare|should use|let slotfeature show|too\b/, 'share.item'],
  [/\binto the library|promote|library item\b/, 'move.item-to-library'],
  [/\bsize|per page|at a time\b/, 'update.variable'],
  [/\blog\b|asks for more|show-more/, 'update.feature-flow'],
  [/\btitle|heading|titled\b/, 'update.page-text'],
  [/\bflow\b/, 'add.flow'],
  [/\bdata\b/, 'add.sample-data'],
  [/\bpage\b/, 'add.page'],
  [/slotname/, 'add.component'],
];

/**
 * Align a request's slots to a case's: same type, same order of appearance. Slots the case derives from others (`of`)
 * keep the case's definition; a feature the request does not name follows the item it owns.
 * @param {string} caseRequest @param {Record<string, any>} caseSlots @param {string} draftRequest @param {Record<string, any>} draftSlots
 * @returns {Record<string, any>} The case's slots, rebound to the request.
 */
export function alignSlots(caseRequest, caseSlots, draftRequest, draftSlots) {
  const want = order(caseRequest);
  const have = order(draftRequest);
  /** @type {Record<string, string>} draft name -> case name */
  const map = {};
  const byType = (names, slots) => names.reduce((acc, n) => { const t = slots[n]?.type; if (t && !acc[t]?.includes(n)) (acc[t] = acc[t] ?? []).push(n); return acc; }, /** @type {Record<string, string[]>} */ ({}));
  const W = byType(want, caseSlots);
  const H = byType(have, draftSlots);
  for (const [type, names] of Object.entries(W)) (H[type] ?? []).forEach((d, i) => { if (names[i]) map[d] = names[i]; });
  const slots = JSON.parse(JSON.stringify(caseSlots));
  const rename = (d) => map[d] ?? (slots[d] && !Object.values(map).includes(d) ? `${d}d` : d);
  for (const [d, c] of Object.entries(map)) {
    const def = { ...draftSlots[d] };
    if (def.of) {
      const of = rename(def.of);
      if (!map[def.of]) slots[of] = { ...draftSlots[def.of] };
      def.of = of;
    }
    if (caseSlots[c]?.kind && !def.kind) def.kind = caseSlots[c].kind;
    slots[c] = def;
  }
  // a feature named only through its item follows that item
  const mapped = new Set(Object.values(map));
  for (const [n, s] of Object.entries(caseSlots)) {
    if (s.type !== 'feature' || mapped.has(n) || !s.ref) continue;
    const owned = Object.entries(caseSlots).find(([m, x]) => x.type === 'item' && mapped.has(m) && x.ref?.startsWith(`item:${s.ref}/`));
    const owner = owned ? slots[owned[0]].ref?.match(/^item:(feature#\d+)\//)?.[1] : null;
    if (owner) slots[n] = { ...s, ref: owner };
  }
  return slots;
}

/**
 * Draft routes for a request over one world.
 * @param {string} request Plain English.
 * @param {{map: {entries: any[]}, cases?: any[], facts?: any, words?: string[]}} ctx `cases`: the stored cases retrieval may use (train split only);
 *   `facts`: the world's facts, so the nearest case that also binds in this world wins.
 * @returns {import('./contract.mjs').TrainDraft & {unknown: any[]}}
 */
export function draft(request, ctx) {
  const n = normalize(request, ctx.map);
  const mine = tokens(n.request);
  const scored = [];
  for (const c of ctx.cases ?? []) {
    if (c.split !== 'train' || c.status === 'disputed') continue;
    const s = jaccard(mine, tokens(c.request));
    if (s >= 0.4) scored.push({ c, s });
  }
  scored.sort((a, b) => b.s - a.s);
  // the nearest case whose slots, aligned to this request, bind in this world (a fix case needs the fixes it names)
  let best = null;
  const seenShape = new Set();
  for (const cand of scored) {
    const shape = `${cand.c.intent}|${cand.c.request}|${cand.c.gold.routes.map((r) => r.id).join(',')}`;
    if (seenShape.has(shape)) continue;
    seenShape.add(shape);
    const slots = cand.c.intent === 'fix.problem' && ctx.facts
      ? fixSlots(cand.c, n.slots, ctx.facts)
      : alignSlots(cand.c.request, cand.c.slots, n.request, n.slots);
    if (!slots) continue;
    if (!ctx.facts || (bindSlots(slots, ctx.facts, ctx.words ?? []).ok && sameRule(cand.c, slots, ctx.facts))) { best = { ...cand, slots }; break; }
    if (seenShape.size > 40) break;
  }
  if (best) {
    const { slots } = best;
    const confidence = Math.round(best.s * 100) / 100;
    return {
      request: n.request, slots, intent: best.c.intent, via: 'retrieval', confidence, unknown: n.unknown,
      routes: best.c.gold.routes.map((r) => ({ ...r, via: /** @type {const} */ ('retrieval'), confidence })),
      recommended: best.c.gold.preferred,
    };
  }
  const text = [...mine].join(' ');
  const intent = RULES.find(([re]) => re.test(text))?.[1] ?? 'ask.missing-detail';
  const def = INTENT_DEFS[intent];
  let bestW = def.wordings[0];
  let bw = -1;
  for (const w of def.wordings) { const s = jaccard(mine, tokens(w.text)); if (s > bw) { bw = s; bestW = w; } }
  const gold = goldFor(intent, bestW.shape === 'any' ? 'cross-feature' : bestW.shape);
  const slots = alignSlots(bestW.text, templateSlots(bestW.text), n.request, n.slots);
  return {
    request: n.request, slots, intent, via: 'template', confidence: 0.3, unknown: n.unknown,
    routes: gold.routes.map((r) => ({ ...r, via: /** @type {const} */ ('template'), confidence: 0.3 })),
    recommended: gold.preferred,
  };
}

/** A fix case fits only a problem of the rule its checks name. */
function sameRule(c, slots, facts) {
  const rules = [...new Set([...JSON.stringify(c.gold.routes).matchAll(/"rule":"([A-Z-]+)"/g)].map((m) => m[1]))];
  const f = Object.values(slots).find((x) => x.type === 'finding');
  if (!f || !rules.length) return true;
  const finding = facts.findings[Number(String(f.ref).split('#')[1])];
  return Boolean(finding) && rules.includes(finding.rule);
}

/**
 * A fix request's slots all follow from the problem it names (by the problem's own file, or an item it sits in, or the
 * only problem there is): the catalog's slot set for that problem, when its routes have the case's shape.
 */
function fixSlots(c, draftSlots, facts) {
  const table = refTable(facts);
  const named = Object.values(draftSlots).map((x) => (x.type === 'finding' ? Number(String(x.ref).split('#')[1]) : x.type === 'item' ? facts.findings.findIndex((f) => f.file === table.get(x.ref)?.file) : -1)).find((i) => i >= 0);
  const i = named ?? (facts.findings.length === 1 ? 0 : -1);
  if (i < 0) return null;
  const want = c.gold.routes.map((r) => r.id).join(',');
  const set = INTENT_DEFS['fix.problem'].slotSets(facts).find((x) => x.slots.P1.ref === `finding#${i}` && goldFor('fix.problem', x.shape).routes.map((r) => r.id).join(',') === want);
  return set ? set.slots : null;
}

/** The bare slot types a catalog wording names (template fallback; derived slots are left for the person to pick). */
function templateSlots(text) {
  /** @type {Record<string, any>} */
  const slots = {};
  for (const m of String(text).matchAll(SLOT_RE)) slots[m[2]] = slots[m[2]] ?? { type: m[1] === 'file' || m[1] === 'hash' ? 'item' : m[1] };
  return slots;
}

/**
 * The phrase of an intent id ("Add a page to a feature").
 * @param {string} id
 * @returns {string}
 */
export const intentPhrase = (id) => INTENTS.find((i) => i.id === id)?.phrase ?? id;
