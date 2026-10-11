// System 1 drafter: draft(request) -> every route that can satisfy it, verified by Construct, ranked, the person picks.
//   normalize (domain map; no domain word passes) -> classify (closed labels) -> enumerate (templates) + retrieve
//   (nearest approved transition) -> verify (scratch copy, expressions, structure hash) -> rank (static; `ranker` = jev)
// The drafter only drafts; adding a route's steps to the plan goes through planService.addStep, where a person approves.
import { readLineProject } from '../model.mjs';
import { LINE_PLAN_TOOLS } from '../contract.mjs';
import { buildIntentCatalog } from './contract.mjs';
import { factsSummary } from './facts.mjs';
import { buildDomainMap, normalize, slotShapes } from './domainMap.mjs';
import { classify } from './classify.mjs';
import { enumerateRoutes } from './templates.mjs';
import { verifyRoutes } from './verify.mjs';
import { structureOf, hashesOf, rolesOf } from './structure.mjs';
import { readRecords, nearest, routeFromRecord } from './retrieval.mjs';
import { bind } from './expr.mjs';

export { normalize, denormalize, buildDomainMap, addSynonym, saveDomainMap } from './domainMap.mjs';
export { toRecord, appendRecord, readRecords } from './retrieval.mjs';
export { createMockDrafter } from './mock.mjs';

/** How an unfilled slot reads (a model or the person fills it). */
const UNBOUND = { K: 'new code', V: 'a value', A: 'a prop', G: 'a piece of code', N: 'a new name' };
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
 * @param {{catalog?: import('./contract.mjs').IntentEntry[], verify?: boolean, ranker?: (routes: import('./contract.mjs').Route[]) => string[], propose?: (word: string, choices: {key: string, label: string}[]) => string|null, records?: import('./contract.mjs').TransitionRecord[]|null, maxVerify?: number}} [o]
 *   `ranker`: jev's ranking (ids, best first); it only orders. `records`: training records (default: the project's own).
 * @returns {import('./contract.mjs').Draft & {questions: any[], shown: {request: string}}}
 */
export function draft(root, request, o = {}) {
  const catalog = o.catalog ?? buildIntentCatalog(LINE_PLAN_TOOLS.map((t) => t.name));
  const project = readLineProject(root);
  const summary = factsSummary(root, project);
  const map = buildDomainMap(root, summary);
  const n = normalize(request, map, { propose: o.propose });
  const graph = structureOf(root, project);
  const roles = rolesOf(graph);
  const slots = slotShapes(n.bindings, n.entries, summary, roles);
  const labels = classify(n, slots, catalog);
  const bindings = { ...n.bindings };
  const targetFeature = labels.target && labels.target[0] === 'F' ? bindings[labels.target] : labels.target && bindings[labels.target]?.feature ? bindings[labels.target].feature : null;
  const from = hashesOf(graph, targetFeature ?? null);
  const words = n.tokens.filter((x) => !x.slot).map((x) => x.t);
  const ctx = { labels, slots, bindings, summary, words };
  const { routes: enumerated, dropped } = labels.inCatalog ? enumerateRoutes(ctx, catalog) : { routes: [], dropped: [] };
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
  // Retrieval: the nearest approved transition of the same intent, re-bound onto this request's slots.
  const records = o.records ?? readRecords(root, summary);
  const near = labels.inCatalog ? nearest(records, { intent: labels.intent.id, request: n.text, from }) : null;
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
  const order = (o.ranker ?? staticRank)(routes);
  routes = order.map((id) => routes.find((r) => r.id === id)).filter(Boolean);
  const rec = routes.find((r) => r.status === 'ok') ?? routes.find((r) => r.status === 'needs-model' || r.status === 'unverified') ?? null;
  const defer = !labels.inCatalog
    ? { to: /** @type {'ask'} */ ('ask'), sentence: 'Line could not tell which kind of change this is; say what to add, change, move, promote or fix, and where.' }
    : n.questions.length
      ? { to: /** @type {'ask'} */ ('ask'), sentence: n.questions[0].sentence }
      : !rec
        ? { to: /** @type {'qwen'} */ ('qwen'), sentence: 'No route passed Construct\'s checks; a local model may propose another, or you can pick a fix.' }
        : rec.status === 'needs-model' || rec.invented.length || labels.intent.confidence < 0.5
          ? { to: /** @type {'qwen'} */ ('qwen'), sentence: rec.status === 'needs-model' ? 'The best route needs a value or code that the request does not give; a local model may propose it, or you type it.' : rec.invented.length ? 'The best route uses a name Line made up; a local model may propose a better one.' : 'Line is not sure which kind of change this is; a local model may confirm it.' }
          : { to: null, sentence: 'The static drafter is confident; no model is needed.' };
  return {
    request: n.text, slots: ctx.slots, labels, from, routes, dropped, recommended: rec?.id ?? null, defer, bindings,
    questions: n.questions, shown: { request: String(request) },
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
  const words = (s) => String(s).replace(/<([A-Z]\d+)(?:\.([a-zA-Z][a-zA-Z0-9]*))?>/g, (m, slot, field) => { const v = b[slot]; if (v === undefined) return UNBOUND[slot[0]] ?? 'something to decide'; if (v && typeof v === 'object') return String(field ? v[field] : v.name ?? v.id); return typeof v === 'string' && /^[VK]/.test(slot) ? `"${v}"` : String(v); });
  return { id: r.id, label: words(r.label), risk: words(r.risk), steps: bind(r.steps, b), refusal: r.refusal };
}
