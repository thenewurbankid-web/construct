// #892: jev as the drafter's classifier, in SHADOW next to the static rules (classify.mjs). Same input and output as
// classify() (a small trained classifier was always meant to drop into that slot), plus a confidence per label:
//
//   classifyJev(normalized, slots, catalog, o) -> Labels & {via: 'jev', confidences} | null
//
// Every label is a closed single-choice question answered through Trace's provider (trace/src/ai/provider.mjs, the
// `jev` provider, the same one `choose` uses): verb and object (the intent id is verb.object from the catalog), the
// target slot (one of the request's slots, or none) and one yes/no question per layer. jev answers each in one forward
// pass with an epistemic confidence. It never throws: jev down, slow or broken -> null, and the static labels stand.
//
// The questions are built here and nowhere else (jevQuestions), so the trainer (trace/tools/jev/train_intent.py, fed
// by build-intent-data.mjs) sees exactly what the provider sends.
import { VERBS, OBJECTS, LAYERS } from './contract.mjs';

/** The step profile that switches jev's labels on (packages/core/ai-profiles.json; off until a measured win). */
export const INTENT_STEP = 'construct.intent';
/** jev's confidence below this marks the label a fork candidate (same default and variable as the jev provider). */
export const DEFAULT_GATE = 0.5;
/** A shadow answer that takes longer than this is dropped (the static labels never wait on jev). */
export const DEFAULT_TIMEOUT_MS = 4000;

const OBJECT_IDS = Object.keys(OBJECTS);
const NONE = 'none';

/**
 * The closed questions jev answers for one normalized request: the state (part + facts) and one single-choice question
 * per label. Options are plain values; the provider numbers them ("1) add").
 * @param {{text?: string, tokens: {t: string, slot?: string, kind?: string}[]}} normalized
 * @param {Record<string, any>} slots
 * @returns {{part: string, facts: string[], questions: {key: string, question: string, options: string[]}[], slotIds: string[]}}
 */
export function jevQuestions(normalized, slots) {
  const text = normalized.text ?? normalized.tokens.map((x) => x.t).join(' ');
  const slotIds = [...new Set(normalized.tokens.filter((x) => x.slot).map((x) => /** @type {string} */ (x.slot)))];
  const facts = [`request: ${text}`];
  for (const s of slotIds.slice(0, 5)) {
    const sh = slots[s] ?? {};
    facts.push(`slot ${s}: ${[sh.kind, sh.itemKind, sh.layer && `layer ${sh.layer}`, sh.area && `in ${sh.area}`, sh.of && `missing ${sh.of}`, sh.handler && 'handler prop'].filter(Boolean).join(', ') || 'unknown'}`);
  }
  const questions = [
    { key: 'verb', question: 'Which change does the request ask for?', options: [...VERBS] },
    { key: 'object', question: 'What kind of thing does the request change?', options: [...OBJECT_IDS] },
  ];
  if (slotIds.length) questions.push({ key: 'slot', question: 'Which named thing is the request about?', options: [...slotIds.map((s) => `${s} ${slots[s]?.kind ?? ''}`.trim()), NONE] });
  for (const l of LAYERS) questions.push({ key: `layer:${l}`, question: `Does the request touch the ${l} layer?`, options: ['yes', 'no'] });
  return { part: 'line request', facts, questions, slotIds };
}

/**
 * The default `choose`: Trace's jev provider (loaded lazily, so the engine never needs Trace to classify statically).
 * @param {{baseUrl?: string}} [o]
 * @returns {Promise<((req: {structured: any}) => Promise<{text: string, confidence?: number}>)|null>}
 */
async function jevChoose(o = {}) {
  try {
    const { makeProvider } = await import('../../../../trace/src/ai/provider.mjs');
    return makeProvider({ provider: 'jev', baseUrl: o.baseUrl ?? process.env.JEV_URL });
  } catch { return null; }
}

/**
 * One single-choice answer: the picked option's index and jev's confidence (null when jev failed).
 * @param {(req: any) => Promise<{text: string, confidence?: number}>} choose
 * @param {{part: string, facts: string[]}} state @param {{question: string, options: string[]}} q
 * @returns {Promise<{index: number, confidence: number}|null>}
 */
async function ask(choose, state, q) {
  try {
    const r = await choose({ system: '', user: q.question, structured: { part: state.part, question: q.question, options: q.options, facts: state.facts, multi: false } });
    const j = JSON.parse(r.text);
    const i = Number(j.choice) - 1;
    if (!Number.isInteger(i) || i < 0 || i >= q.options.length) return null;
    const c = Number(r.confidence);
    return { index: i, confidence: Number.isFinite(c) ? Math.round(c * 1000) / 1000 : 0 };
  } catch { return null; }
}

const timeout = (ms) => new Promise((resolve) => { const t = setTimeout(() => resolve(null), ms); t.unref?.(); });

/**
 * jev's labels for a normalized request, in classify()'s shape plus `confidences`; null when jev cannot answer.
 * @param {{text?: string, tokens: {t: string, slot?: string, kind?: string}[]}} normalized
 * @param {Record<string, any>} slots
 * @param {import('./contract.mjs').IntentEntry[]} catalog
 * @param {{choose?: (req: any) => Promise<{text: string, confidence?: number}>, baseUrl?: string, timeoutMs?: number}} [o]
 *   `choose`: a provider function (tests pass a fake); default Trace's jev provider at JEV_URL or 127.0.0.1:8765.
 * @returns {Promise<(import('./contract.mjs').Labels & {via: 'jev', confidences: {intent: number, verb: number, object: number, slot: number, layers: Record<string, number>}})|null>}
 */
export async function classifyJev(normalized, slots, catalog, o = {}) {
  try {
    const choose = o.choose ?? await jevChoose(o);
    if (!choose) return null;
    const qs = jevQuestions(normalized, slots);
    const state = { part: qs.part, facts: qs.facts };
    const run = Promise.all(qs.questions.map((q) => ask(choose, state, q)));
    const answers = await Promise.race([run, timeout(o.timeoutMs ?? DEFAULT_TIMEOUT_MS)]);
    if (!answers || answers.some((a) => a === null)) return null;
    const by = Object.fromEntries(qs.questions.map((q, i) => [q.key, { q, a: /** @type {{index: number, confidence: number}} */ (answers[i]) }]));
    const verb = VERBS[by.verb.a.index];
    const object = OBJECT_IDS[by.object.a.index];
    const id = `${verb}.${object}`;
    const inCatalog = catalog.some((e) => e.id === id);
    const intentConf = Math.min(by.verb.a.confidence, by.object.a.confidence);
    const slotPick = by.slot ? (by.slot.a.index < qs.slotIds.length ? qs.slotIds[by.slot.a.index] : null) : null;
    const layerConf = {};
    const layers = [];
    for (const l of LAYERS) {
      const a = by[`layer:${l}`].a;
      layerConf[l] = a.confidence;
      if (a.index === 0) layers.push({ layer: l, confidence: a.confidence });
    }
    layers.sort((a, b) => b.confidence - a.confidence || a.layer.localeCompare(b.layer));
    return {
      intent: inCatalog ? { id, confidence: intentConf } : { id: 'unknown', confidence: 0 },
      alternatives: [],
      inCatalog,
      target: slotPick,
      layers,
      via: /** @type {'jev'} */ ('jev'),
      confidences: { intent: intentConf, verb: by.verb.a.confidence, object: by.object.a.confidence, slot: by.slot ? by.slot.a.confidence : 1, layers: layerConf },
    };
  } catch { return null; }
}

// ------------------------------------------------------------------------------------------------ closed labels + forks

/**
 * A slot as a stable, readable key: "<kind>:<name>" ("page:OrdersPage", "feature:orders"); null for no slot.
 * @param {string|null|undefined} slot @param {Record<string, any>} slots @param {Record<string, any>} [bindings]
 * @returns {string|null}
 */
export function slotKey(slot, slots, bindings = {}) {
  if (!slot) return null;
  const v = bindings[slot];
  const name = v && typeof v === 'object' ? v.name ?? v.id : v;
  return `${slots[slot]?.kind ?? 'slot'}:${name ?? slot}`;
}

/**
 * The four closed labels of a Labels result (what a gold record holds): intent, object, slot, layers.
 * @param {import('./contract.mjs').Labels|null} labels @param {Record<string, any>} slots @param {Record<string, any>} [bindings]
 * @returns {{intent: string, object: string|null, slot: string|null, layers: string[]}|null}
 */
export function closedLabels(labels, slots, bindings = {}) {
  if (!labels) return null;
  const id = labels.intent.id;
  return { intent: id, object: id === 'unknown' ? null : id.split('.').slice(1).join('.'), slot: slotKey(labels.target, slots, bindings), layers: labels.layers.map((x) => x.layer).sort() };
}

/**
 * Fork candidates: every label where jev differs from static, or jev's confidence is under the gate. Both values are kept
 * so a beam can open one run per side (#893). Empty when jev did not answer.
 * @param {ReturnType<typeof closedLabels>} st @param {ReturnType<typeof closedLabels>} jv
 * @param {{intent: number, object: number, slot: number, layers: Record<string, number>}|null|undefined} conf
 * @param {number} [gate]
 * @returns {{label: 'intent'|'object'|'slot'|'layers', static: any, jev: any, confidence: number, reason: 'disagree'|'low-confidence'|'both'}[]}
 */
export function forksOf(st, jv, conf, gate = DEFAULT_GATE) {
  if (!st || !jv || !conf) return [];
  const layerConf = Math.min(...Object.values(conf.layers));
  /** @type {[any, any, any, number][]} */
  const rows = [['intent', st.intent, jv.intent, conf.intent], ['object', st.object, jv.object, conf.object], ['slot', st.slot, jv.slot, conf.slot], ['layers', st.layers, jv.layers, layerConf]];
  const out = [];
  for (const [label, s, j, c] of rows) {
    const differ = JSON.stringify(s) !== JSON.stringify(j);
    const low = c < gate;
    if (differ || low) out.push({ label, static: s, jev: j, confidence: c, reason: /** @type {any} */ (differ && low ? 'both' : differ ? 'disagree' : 'low-confidence') });
  }
  return out;
}
