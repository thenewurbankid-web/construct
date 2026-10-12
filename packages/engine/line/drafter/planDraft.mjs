// The drafter as an optional first step of the plan (feature flag LINE_DRAFTER=1, default off): a person types what
// they want, the drafter lists every route (verified by Construct in a scratch copy), the person picks one, and its
// steps join the plan through planService.addStep like any other step. A person still approves every write; the
// drafter itself writes nothing to the project's code. Picking a route records one delexicalized transition (and an
// answered "Did you mean ...?" one synonym) in the project's Line state, through Construct's writer. Train Line's
// verified, undisputed, slotted precedents (line/train/retrieval-index.json) may rank the routes (owner, 2026-10-11);
// Construct still checks every route and a person approves it.
import { readLineProject } from '../model.mjs';
import { draft as staticDraft, boundRoute } from './index.mjs';
import { factsSummary } from '../facts.mjs';
import { addSynonym } from './domainMap.mjs';
import { toRecord, appendRecord, precedentsFromTraining } from './retrieval.mjs';
import { createRepairer } from '../repair.mjs';

/**
 * Whether the drafter is on (LINE_DRAFTER=1 or "on").
 * @param {Record<string, string|undefined>} [env]
 * @returns {boolean}
 */
export function drafterEnabled(env = process.env) {
  return env.LINE_DRAFTER === '1' || env.LINE_DRAFTER === 'on';
}

const refusal = (code, sentence) => ({ ok: /** @type {const} */ (false), code, sentence });
const STATUS = {
  ok: 'Construct tried it on a copy of the project: every check passes.',
  'needs-model': 'It needs code or a value your request does not give; add it to the request, or let a local model propose it.',
  unverified: 'Not checked yet.',
  'wrong-shape': 'Construct tried it on a copy, but the result is not shaped as Line predicted, so Line holds it back.',
};

/**
 * One route as Cockpit shows it: plain English first, the steps under Details.
 * @param {any} d  A draft.
 * @param {import('./contract.mjs').Route} r
 * @returns {import('../contract.mjs').DraftRouteView}
 */
function routeView(d, r) {
  const b = boundRoute(d, r.id);
  const sentence = r.status === 'refused' ? r.refusal?.sentence ?? 'Construct refused it.' : r.status === 'failed' ? `Construct tried it on a copy, but a check failed: ${String(r.failed[0] ?? '').replace(/^\w/, (c) => c.toLowerCase())}` : STATUS[r.status];
  return {
    id: r.id, label: /** @type {any} */ (b).label, risk: /** @type {any} */ (b).risk, status: /** @type {any} */ (r.status), sentence, via: r.via, confidence: r.confidence,
    cost: r.cost, steps: /** @type {any} */ (b).steps, fix: r.refusal?.fix ? { sentence: r.refusal.fix.sentence } : null,
    repair: /** @type {any} */ (r).repair ? { outcome: /** @type {any} */ (r).repair.outcome, sentence: /** @type {any} */ (r).repair.sentence } : null,
  };
}

/**
 * im2: a route a model proposed (via "model") that Construct refused gets ONE repair from the exact error: the local
 * model sees the refusal sentence, the finding and the typed fix, answers in the step's schema, and Construct checks the
 * repaired step on a copy again. Repaired: the route is checked and can be added (a person still approves it). Still
 * refused, or not repairable: it stays refused and the person decides. Only one-step routes; each route once.
 * @param {any} d A draft (changed in place).
 * @param {(option: any, refusal: any) => Promise<any>} repair createRepairer's function.
 * @returns {Promise<any[]>} The attempts made.
 */
export async function repairModelRoutes(d, repair) {
  const attempts = [];
  for (const r of d.routes) {
    if (r.via !== 'model' || r.repair || !['refused', 'failed'].includes(r.status)) continue;
    const steps = /** @type {any} */ (boundRoute(d, r.id)).steps;
    if (steps.length !== 1) continue;
    const refusal = r.status === 'failed'
      ? { sentence: `A check failed: ${String(r.failed?.[0] ?? 'a check did not hold')}`, rule: null, code: null, fixes: [] }
      : { sentence: r.refusal?.sentence ?? 'Construct refused it.', rule: r.refusal?.rule ?? null, code: r.refusal?.code ?? null, fixes: r.refusal?.fix ? [{ id: r.refusal.fix.id ?? 'fix', sentence: r.refusal.fix.sentence, rank: 1, step: r.refusal.fix.step ?? null }] : [] };
    const attempt = await repair(steps[0], refusal);
    r.repair = attempt;
    attempts.push(attempt);
    if (attempt.outcome === 'repaired') Object.assign(r, { status: 'ok', steps: [attempt.option], refusal: null, failed: [] });
  }
  if (attempts.some((a) => a.outcome === 'repaired') && !d.recommended) d.recommended = d.routes.find((x) => x.status === 'ok')?.id ?? null;
  return attempts;
}

/**
 * The drafter wired in front of one project's plan service.
 * @param {{root: string, plan: {addStep: (req: any, by: string) => Promise<any>, view: () => Promise<any>}, enabled?: boolean,
 *   draftFn?: (root: string, request: string) => any, record?: boolean, repair?: ((option: any, refusal: any) => Promise<any>) | false}} o
 *   `repair` (im2): the one repair of a model's refused route (default: the local 1.5B through Ollama; false: off).
 * @returns {{status: () => {ok: true, on: boolean}, draft: (request: unknown) => Promise<any>, addRoute: (request: unknown, routeId: unknown, by: string, from?: unknown) => Promise<any>, answer: (word: unknown, key: unknown) => Promise<any>}}
 */
export function createPlanDrafter({ root, plan, enabled = drafterEnabled(), draftFn = (r, q) => staticDraft(r, q, { precedents: precedentsFromTraining() }), record = true, repair = createRepairer(root, { where: 'drafter' }) }) {
  const cache = new Map();
  const off = () => refusal('DRAFTER_OFF', 'The drafter is off; start the server with LINE_DRAFTER=1 to turn it on.');
  const asRequest = (q) => (typeof q === 'string' ? q.trim().slice(0, 500) : '');
  const get = (q) => { if (!cache.has(q)) { if (cache.size > 20) cache.clear(); cache.set(q, draftFn(root, q)); } return cache.get(q); };

  async function draftView(q) {
    if (!enabled) return off();
    const request = asRequest(q);
    if (!request) return refusal('BAD_ARGS', 'Say what you want to change, for example "add a badge to the orders feature".');
    cache.delete(request);
    const d = get(request);
    if (repair) await repairModelRoutes(d, repair);
    return {
      ok: true, on: true, request, normalized: d.request,
      intent: { id: d.labels.intent.id, confidence: d.labels.intent.confidence, inCatalog: d.labels.inCatalog },
      routes: d.routes.map((r) => routeView(d, r)), recommended: d.recommended, defer: d.defer,
      questions: d.questions.map((x) => ({ word: x.word, sentence: x.sentence, choices: x.choices, suggested: x.suggested })),
      dropped: d.dropped.map((x) => ({ sentence: x.sentence })),
    };
  }

  async function addRoute(q, routeId, by, from) {
    if (!enabled) return off();
    const request = asRequest(q);
    const d = request ? get(request) : null;
    const r = d?.routes.find((x) => x.id === routeId);
    if (!d || !r) return refusal('UNKNOWN_ROUTE', 'That route is not in the latest draft; draft the request again and pick one.');
    if (r.status === 'refused') return refusal('ROUTE_REFUSED', r.refusal?.sentence ?? 'Construct refused this route.');
    if (r.status === 'needs-model') return refusal('NEEDS_INPUT', 'This route needs code or a value your request does not give; add it to the request and draft again.');
    const steps = /** @type {any} */ (boundRoute(d, r.id)).steps;
    const start = Number.isInteger(from) && Number(from) > 0 ? Number(from) : 0;
    const added = [];
    let last = null;
    for (let i = start; i < steps.length; i++) {
      const out = await plan.addStep({ tool: steps[i].tool, args: steps[i].args }, by);
      if (out.ok === false) {
        if (!added.length) return out;
        // A later step can only be planned once the earlier ones ran (e.g. base on what was just promoted).
        return { ...last, added, next: i, sentence: `Added ${added.length} of ${steps.length} steps; add the rest after step ${added.length} runs, because ${String(out.sentence).replace(/^\w/, (c) => c.toLowerCase())}` };
      }
      added.push(out.stepId);
      last = out;
    }
    if (record && start === 0) {
      try { appendRecord(root, factsSummary(root, readLineProject(root)), toRecord(d, r.id, true)); } catch { /* a record is best effort; the plan step stands */ }
    }
    return { ...last, added, next: null, sentence: `Added ${added.length === 1 ? 'one step' : `${added.length} steps`} to the plan; approve ${added.length === 1 ? 'it' : 'each'} to run.` };
  }

  async function answer(word, key) {
    if (!enabled) return off();
    if (typeof word !== 'string' || !word.trim() || typeof key !== 'string' || !key) return refusal('BAD_ARGS', 'Pick one of the choices for the word.');
    try {
      addSynonym(root, factsSummary(root, readLineProject(root)), word.trim(), key);
    } catch (e) {
      return refusal(/** @type {any} */ (e)?.code ?? 'WRITE_FAILED', /** @type {any} */ (e)?.sentence ?? 'Line could not remember that answer.');
    }
    cache.clear();
    return { ok: true, sentence: `Line will read "${word.trim()}" that way from now on in this project.` };
  }

  return { status: () => ({ ok: true, on: enabled }), draft: draftView, addRoute, answer };
}
