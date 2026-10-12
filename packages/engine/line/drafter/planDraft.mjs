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
import { memoryOf, routeKey, draftContext, memoryBy } from '../memory/index.mjs';

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
    memory: /** @type {any} */ (r).memory ?? null,
  };
}

/**
 * The drafter wired in front of one project's plan service.
 * @param {{root: string, plan: {addStep: (req: any, by: string) => Promise<any>, view: () => Promise<any>}, enabled?: boolean,
 *   draftFn?: (root: string, request: string, o?: {memory?: any}) => any, record?: boolean, memory?: any}} o `memory` (im3 + j5): this
 *   project's memory (default memory/index.mjs memoryOf(root); null for none): a picked route is remembered, and the
 *   person's consistent past picks move a checked route first.
 * @returns {{status: () => {ok: true, on: boolean}, draft: (request: unknown) => Promise<any>, addRoute: (request: unknown, routeId: unknown, by: string, from?: unknown) => Promise<any>, answer: (word: unknown, key: unknown) => Promise<any>}}
 */
export function createPlanDrafter({ root, plan, enabled = drafterEnabled(), draftFn = (r, q, x) => staticDraft(r, q, { precedents: precedentsFromTraining(), ...x }), record = true, memory }) {
  const mem = memory === undefined ? memoryOf(root) : memory;
  const cache = new Map();
  const off = () => refusal('DRAFTER_OFF', 'The drafter is off; start the server with LINE_DRAFTER=1 to turn it on.');
  const asRequest = (q) => (typeof q === 'string' ? q.trim().slice(0, 500) : '');
  const get = (q) => { if (!cache.has(q)) { if (cache.size > 20) cache.clear(); cache.set(q, draftFn(root, q, mem ? { memory: mem } : {})); } return cache.get(q); };

  async function draftView(q) {
    if (!enabled) return off();
    const request = asRequest(q);
    if (!request) return refusal('BAD_ARGS', 'Say what you want to change, for example "add a badge to the orders feature".');
    cache.delete(request);
    const d = get(request);
    return {
      ok: true, on: true, request, normalized: d.request,
      intent: { id: d.labels.intent.id, confidence: d.labels.intent.confidence, inCatalog: d.labels.inCatalog },
      routes: d.routes.map((r) => routeView(d, r)), recommended: d.recommended, defer: d.defer,
      questions: d.questions.map((x) => ({ word: x.word, sentence: x.sentence, choices: x.choices, suggested: x.suggested })),
      dropped: d.dropped.map((x) => ({ sentence: x.sentence })),
      memory: d.memory ? { route: d.memory.route, count: d.memory.count, sentence: d.memory.sentence } : null,
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
    // im3: remember the pick against what Line recommended (slotted; a memory that cannot be saved never stops the plan).
    if (mem && start === 0) {
      const options = [...new Set(d.routes.filter((x) => x.status === 'ok').map((x) => routeKey(x.id)))];
      try {
        await mem.recordOutcome('drafter.route', { ...draftContext(d), options, proposed: d.recommended ? routeKey(d.recommended) : null }, { kind: 'picked', chosen: routeKey(r.id), by: memoryBy(by) });
      } catch { /* best effort */ }
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
