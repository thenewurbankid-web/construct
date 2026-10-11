// Train Line over MCP (Claude's side): Claude proposes training cases, lists them and runs eval. Read-only except that
// a proposal adds one case (labelled 'claude', status 'draft', kept only when Construct verifies every route in a
// scratch copy). There is no approve tool: only the owner moves a case to agreed or disputed, in Cockpit's Train Line.
// The training root is LINE_TRAIN_ROOT, else the Construct repo's line/ folder; nothing here touches the open project.
import { ToolError } from './limits.mjs';

let service = null;
async function serviceOf() {
  if (!service) {
    const { createTrainService } = await import('@line/construct-engine/line/train/service');
    const { DEFAULT_TRAIN_ROOT } = await import('@line/construct-engine/line/train/store');
    service = createTrainService({ root: process.env.LINE_TRAIN_ROOT || DEFAULT_TRAIN_ROOT, seedFrom: DEFAULT_TRAIN_ROOT });
  }
  return service;
}

/** A refusal (a LineOpError) as a typed tool error with its sentence. */
function refused(e) {
  if (e?.name === 'LineOpError') throw new ToolError('TRAIN_REFUSED', String(e.sentence), { reason: String(e.code) });
  throw e;
}

/** Only what an agent needs of a case: its id, intent, wording with names filled, routes as sentences, status. */
const brief = (c) => ({
  id: c.id, intent: c.intent, intentPhrase: c.filled.intentPhrase, request: c.filled.request, world: c.filled.world, split: c.split,
  labelledBy: c.labelledBy, status: c.status, notes: c.notes.map((n) => `${n.by}: ${n.text}`),
  routes: c.filled.routes.map((r) => ({ id: r.id, label: r.label, preferred: r.preferred, steps: r.steps.map((s) => s.sentence), checks: r.checks })),
});

/**
 * `train_propose_case`: add one case as Claude's proposal.
 * @param {any} _ctx @param {{world?: string, request: string, intent: string, routes: any[], preferred?: number, note?: string}} args
 * @returns {Promise<any>}
 */
export async function proposeTrainingCase(_ctx, args) {
  const svc = await serviceOf();
  try { return { ok: true, case: brief(svc.propose(args).case) }; } catch (e) { return refused(e); }
}

/**
 * `train_list_cases`: a page of cases (filter: sample, claude, mine, all).
 * @param {any} _ctx @param {{filter?: string, limit?: number, offset?: number}} args
 * @returns {Promise<any>}
 */
export async function listTrainingCases(_ctx, args) {
  const r = (await serviceOf()).cases({ filter: args.filter ?? 'claude', limit: args.limit ?? 10, offset: args.offset ?? 0 });
  return { ok: true, total: r.total, open: r.open, cases: r.cases.map(brief) };
}

/**
 * `train_run_eval`: draft every held-out case and score it; the numbers come back, nothing is saved.
 * @returns {Promise<any>}
 */
export async function runTrainingEval() {
  const svc = await serviceOf();
  const { evaluateAll, scoreboard } = await import('@line/construct-engine/line/train/service');
  const result = evaluateAll(svc.store.all(), new Date().toISOString());
  const sb = scoreboard(svc.store.all(), result);
  return { ...sb, byIntent: Object.fromEntries(Object.entries(sb.byIntent).map(([k, v]) => [k, { label: v.label, heldout: v.heldout, recall: v.recall, precision: v.precision, preferred: v.preferred, agreement: v.agreement }])) };
}
