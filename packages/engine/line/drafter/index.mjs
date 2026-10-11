// System 1 drafter: draft(request) -> every route that can satisfy it, verified by Construct, ranked, the person picks.
//   normalize (domain map; no domain word passes) -> classify (closed labels) -> enumerate (templates) + retrieve
//   (nearest approved transition) -> verify (scratch copy, expressions, structure hash) -> rank (static; `ranker` = jev)
// The drafter only drafts; adding a route's steps to the plan goes through planService.addStep, where a person approves.
import { readLineProject } from '../model.mjs';
import { LINE_PLAN_TOOLS } from '../contract.mjs';
import { buildIntentCatalog } from './contract.mjs';
import { factsSummary } from '../facts.mjs';
import { structureGraph, readerOf, hashesOf, rolesOf } from '../structure.mjs';
import { buildDomainMap, normalize, slotShapes, bind } from './domainMap.mjs';
import { classify } from './classify.mjs';
import { enumerateRoutes } from './templates.mjs';
import { verifyRoutes } from './verify.mjs';
import { readRecords, nearest, routeFromRecord, precedent } from './retrieval.mjs';

export { normalize, denormalize, buildDomainMap, addSynonym, saveDomainMap } from './domainMap.mjs';
export { toRecord, appendRecord, readRecords } from './retrieval.mjs';
export { createMockDrafter } from './mock.mjs';

/** How an unfilled slot reads (a model or the person fills it). */
const UNBOUND = { K: 'new code', V: 'a value', A: 'a prop', G: 'a piece of code', N: 'a new name' };
/** Construct refusals that answer the request as asked (a missing feature or library item, a taken name). */
const ANSWER_CODES = new Set(['UNKNOWN_FEATURE', 'UNKNOWN_ITEM', 'NAME_TAKEN']);
/** The one closed question a precedent asked, by what it was about. */
const PRECEDENT_ASK = Object.freeze({ name: 'What should the new item be called?', library: 'Which library item should the new item be based on?', detail: 'Line needs one more detail before it can draft this; pick a route or say which.' });

/**
 * A slot-form sentence in the project's words (shown, never stored).
 * @param {string} s @param {Record<string, any>} b
 * @returns {string}
 */
function say(s, b) {
  return String(s).replace(/<([A-Z]\d+)(?:\.([a-zA-Z][a-zA-Z0-9]*))?>/g, (m, slot, field) => { const v = b[slot]; if (v === undefined) return UNBOUND[slot[0]] ?? 'something to decide'; if (v && typeof v === 'object') return String(field ? v[field] : v.name ?? v.id); return typeof v === 'string' && /^[VK]/.test(slot) ? `"${v}"` : String(v); });
}
const ORDER = { ok: 0, 'needs-model': 1, unverified: 2, failed: 3, 'wrong-shape': 4, refused: 5 };

/**
 * Static ranking: verified first, then confidence, then fewer steps and files, then id (deterministic).
 * @param {import('./contract.mjs').Route[]} routes
 * @returns {string[]} Route ids, best first.
 */
export function staticRank(routes) {
  return [...routes].sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.confidence - a.confidence || a.cost.steps - b.cost.steps || a.cost.files - b.cost.files || a.id.localeCompare(b.id)).map((r) => r.id);
}

/**
 * Draft every route for a request on the project at `root`.
 * @param {string} root
 * @param {string} request
 * @param {{catalog?: import('./contract.mjs').IntentEntry[], verify?: boolean, ranker?: (routes: import('./contract.mjs').Route[]) => string[], propose?: (word: string, choices: {key: string, label: string}[]) => string|null, records?: import('./contract.mjs').TransitionRecord[]|null, maxVerify?: number, synonyms?: Record<string, string>}} [o]
 *   `synonyms`: confirmed synonyms kept outside the project (word -> domain-map key), e.g. Train Line's per-world ones.
 *   `ranker`: jev's ranking (ids, best first); it only orders. `records`: training records (default: the project's own).
 * @returns {import('./contract.mjs').Draft & {questions: any[], shown: {request: string}, tokens: {t: string, slot?: string, kind?: string, src: string[]}[], entries: Record<string, string>}}
 *   `tokens` and `entries` are the live normalization (they hold the request's own words: shown, never stored).
 */
export function draft(root, request, o = {}) {
  const catalog = o.catalog ?? buildIntentCatalog(LINE_PLAN_TOOLS.map((t) => t.name));
  const project = readLineProject(root);
  const summary = factsSummary(root, project);
  const map = buildDomainMap(root, summary, { synonyms: o.synonyms });
  const n = normalize(request, map, { propose: o.propose });
  const graph = structureGraph(project, readerOf(root));
  const roles = rolesOf(graph);
  const slots = slotShapes(n.bindings, n.entries, summary, roles);
  const records = o.records ?? readRecords(root, summary);
  // A strong precedent (an approved request with the same slots, worded nearly the same) says what kind of change this
  // is, even when the rules cannot tell or tell otherwise.
  const prec = precedent(records, { request: n.text });
  let labels = classify(n, slots, catalog);
  if (prec && prec.intent !== labels.intent.id && catalog.some((e) => e.id === prec.intent)) {
    labels = { ...labels, intent: { id: prec.intent, confidence: Math.max(0.6, labels.intent.confidence) }, inCatalog: true, alternatives: [], via: /** @type {any} */ ('retrieval') };
  }
  const bindings = { ...n.bindings };
  const targetFeature = labels.target && labels.target[0] === 'F' ? bindings[labels.target] : labels.target && bindings[labels.target]?.feature ? bindings[labels.target].feature : null;
  const from = hashesOf(graph, targetFeature ?? null);
  const words = n.tokens.filter((x) => !x.slot).map((x) => x.t);
  const ctx = { labels, slots, bindings, summary, words };
  const { routes: enumerated, dropped } = labels.inCatalog ? enumerateRoutes(ctx, catalog) : { routes: [], dropped: [] };
  /** @type {any[]} */
  let routes = enumerated;
  // Ambiguous slots: the same routes for each other candidate (the person picks), ids marked @<slot>=<n>.
  for (const [s, keys] of Object.entries(n.ambiguous)) {
    keys.slice(1, 3).forEach((key, i) => {
      const e = map.entries.find((x) => x.key === key);
      if (!e) return;
      const alt = { ...bindings, [s]: e.type === 'feature' ? e.value.name : { ...e.value } };
      for (const r of enumerated.filter((x) => JSON.stringify(x.steps).includes(`<${s}`))) routes.push({ ...r, id: `${r.id}@${s}=${i + 2}`, bindings: alt, confidence: Math.round(r.confidence * 0.7 * 100) / 100 });
    });
  }
  // Retrieval: the precedent's routes (its preferred one first), else the nearest approved transition of the same
  // intent, re-bound onto this request's slots.
  const precPreferred = prec?.records.find((r) => r.preferred) ?? null;
  if (prec) {
    let preferredHere = false;
    for (const rec of prec.records.filter((r) => r.steps.length)) {
      const rr = routeFromRecord(rec, slots, prec.score);
      if (!rr) continue;
      preferredHere ||= Boolean(rec.preferred);
      const same = routes.find((r) => JSON.stringify(r.steps) === JSON.stringify(rr.steps));
      // The precedent's preferred route ranks first; its other routes are kept as they rank.
      if (same) routes = routes.map((r) => (r === same ? { ...r, confidence: rec.preferred ? 1 : r.confidence, retrieved: true } : r));
      else if (!routes.some((r) => r.id === rr.id)) routes.push({ ...rr, confidence: rec.preferred ? 1 : 0.5, retrieved: true });
    }
    // Routes no precedent holds rank below the precedent's preferred one (when it could be re-bound here at all).
    if (preferredHere) routes = routes.map((r) => (r.retrieved ? r : { ...r, confidence: Math.round(r.confidence * 0.8 * 100) / 100 }));
  }
  const near = !prec && labels.inCatalog ? nearest(records, { intent: labels.intent.id, request: n.text, from }) : null;
  if (near) {
    const rr = routeFromRecord(near.record, slots, near.score);
    const same = rr && routes.find((r) => JSON.stringify(r.steps) === JSON.stringify(rr.steps));
    if (same) routes = routes.map((r) => (r === same ? { ...r, confidence: Math.min(1, Math.round((r.confidence + 0.1) * 100) / 100), retrieved: true } : r));
    else if (rr) routes.push(rr);
  }
  if (o.verify !== false) {
    const plain = routes.filter((r) => !r.bindings);
    const alts = routes.filter((r) => r.bindings);
    routes = [...verifyRoutes(root, plain, bindings, { max: o.maxVerify }), ...alts.flatMap((r) => verifyRoutes(root, [r], r.bindings, { max: 1 }))];
  }
  // The precedent was refused as asked (a missing feature or library item, a taken name) and is refused here too:
  // that refusal is the answer, not a route that does something else.
  if (precPreferred?.outcome === 'refusal' && routes.some((r) => r.retrieved && r.status === 'refused')) routes = routes.filter((r) => r.retrieved);
  const order = (o.ranker ?? staticRank)(routes);
  routes = order.map((id) => routes.find((r) => r.id === id)).filter(Boolean);
  const rec = routes.find((r) => r.status === 'ok') ?? routes.find((r) => r.status === 'needs-model' || r.status === 'unverified') ?? null;
  // Refusal semantics: the request named a feature or library item that does not exist, or a name that is taken, and
  // every route was refused: Construct's own sentence is the answer (a near miss was already a "Did you mean" question).
  const refusedAll = routes.length > 0 && routes.every((r) => r.status === 'refused');
  // (Starting a new feature is refused because Line has no tool for it yet: that is not an answer, a model or person decides.)
  const asked = refusedAll ? routes.find((r) => r.template !== 'new-feature' && ANSWER_CODES.has(r.refusal?.code ?? '')) : null;
  // Ask vs invent: the recommended route had to make up a name (or guess a library item) the request does not give.
  //   A precedent whose preferred answer was a question asks the same (its routes stay as the closed choices).
  const precAsk = precPreferred?.outcome === 'question' ? { about: precPreferred.about ?? 'detail', sentence: PRECEDENT_ASK[precPreferred.about] ?? PRECEDENT_ASK.detail } : null;
  const ask = n.questions.length ? null : rec?.ask ?? precAsk;
  const defer = !labels.inCatalog
    ? { to: /** @type {'ask'} */ ('ask'), sentence: 'Line could not tell which kind of change this is; say what to add, change, move, promote or fix, and where.' }
    : n.questions.length
      ? { to: /** @type {'ask'} */ ('ask'), sentence: n.questions[0].sentence }
      : asked
        ? { to: null, sentence: `Construct refuses this as asked: ${asked.refusal.sentence}` }
      : ask
        ? { to: /** @type {'ask'} */ ('ask'), about: ask.about, sentence: say(ask.sentence, rec?.bindings ?? bindings), choices: routes.filter((r) => (r.ask?.about === ask.about || ask === precAsk) && r.status === 'ok').map((r) => r.id) }
      : !rec
        ? { to: /** @type {'qwen'} */ ('qwen'), sentence: 'No route passed Construct\'s checks; a local model may propose another, or you can pick a fix.' }
        : rec.status !== 'ok' || labels.intent.confidence < 0.5
          ? { to: /** @type {'qwen'} */ ('qwen'), sentence: rec.status === 'needs-model' ? 'The best route needs a value or code that the request does not give; a local model may propose it, or you type it.' : rec.status === 'ok' ? 'Line is not sure which kind of change this is; a local model may confirm it.' : 'No route has been checked yet; a local model may propose one.' }
          : { to: null, sentence: rec.invented.length ? 'The static drafter is confident; a rule made up the new name, which you can change or let a local model suggest.' : 'The static drafter is confident; no model is needed.' };
  return {
    request: n.text, slots: ctx.slots, labels, from, routes, dropped, recommended: rec?.id ?? null, defer, bindings,
    questions: n.questions, shown: { request: String(request) }, tokens: n.tokens, entries: n.entries,
  };
}

/**
 * A route of a draft with the project's names filled in: its steps ready for planService.addStep, and its words.
 * @param {ReturnType<typeof draft>} d
 * @param {string} routeId
 * @returns {{id: string, label: string, risk: string, steps: {tool: string, args: Record<string, unknown>}[], refusal: any}|null}
 */
export function boundRoute(d, routeId) {
  const r = d.routes.find((x) => x.id === routeId);
  if (!r) return null;
  const b = /** @type {any} */ (r).bindings ?? d.bindings;
  const words = (s) => say(s, b);
  return { id: r.id, label: words(r.label), risk: words(r.risk), steps: bind(r.steps, b), refusal: r.refusal };
}
