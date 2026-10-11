// cp1 -- the one plan session per open project, shared by Cockpit (ui/server lineplanApi.mjs, as "ui") and agents
// (packages/mcp plan_* tools, as "agent"). It drives @mx/plan when the link is up (packages/line-links importLinked)
// and Line's built-in plan store otherwise (planFallback.mjs, same contract, same file), and says which in one
// sentence. Both keep the session in `<root>/line/plans/ses-cockpit.json`, written atomically by the plan store.
//
//   view()                  the session's current plan as Cockpit shows it (PlanView, contract.mjs)
//   addStep(req, by)        a step {tool, args, why?}; a change tool is planned first (a refusal never joins the plan),
//                           worded by its StagedChange summary and given the default checks (`expect`)
//   approve(stepId, by)     only a person approves a write (the plan store refuses an agent)
//   runNext(by, stepId?)    runs exactly one ready (approved) step; refuses while a step needs the person
//
// Nothing here writes a project file: a step's write happens only when the plan runner calls the registry
// (planTools.mjs -> applyChange -> Construct's transactional writer).
import { importLinked } from '../../line-links/index.mjs';
import { CHANGE_TOOLS, DEFAULT_EXPECT, REAL_PLAN_OPS, createLinePlanRegistry, constructCommandTools, gapOf, previewStep } from './planTools.mjs';
import { createAtomicPlanWriter, createStaticPlanApi } from './planFallback.mjs';

/** One session per open project, for now. */
export const SESSION_ID = 'ses-cockpit';
const SUFFIX = 'cockpit';
export const DEFAULT_GOAL = 'Change this project in Cockpit.';

const lower = (s) => String(s).charAt(0).toLowerCase() + String(s).slice(1);
const asSentence = (s) => { const t = String(s ?? '').trim().replace(/\s+/g, ' '); return /[.?!]$/.test(t) ? t : `${t}.`; };
const refusal = (code, sentence) => ({ ok: /** @type {const} */ (false), code, sentence: asSentence(sentence) });
const fromPlan = (r) => refusal(`PLAN_${String(r.code).toUpperCase()}`, r.reason);

/**
 * Load the plan API for `root`: @mx/plan when linked, else the built-in store.
 * @param {{root: string, registry: any, linkOptions?: object}} o
 * @returns {Promise<{api: any, store: {linked: boolean, sentence: string}}>}
 */
export async function loadPlanApi({ root, registry, linkOptions }) {
  const linked = await importLinked('@mx/plan', linkOptions);
  if (linked.ok && typeof linked.module.createPlanApi === 'function') {
    const m = linked.module;
    return { api: m.createPlanApi({ registry, writer: m.createFileWriter(root), newId: () => SUFFIX }), store: { linked: true, sentence: 'Plans are kept by @mx/plan in line/plans of this project.' } };
  }
  return {
    api: createStaticPlanApi({ registry, writer: createAtomicPlanWriter(root), newId: () => SUFFIX }),
    store: { linked: false, sentence: `Line keeps plans in its built-in store in line/plans, because ${lower(String(/** @type {any} */ (linked).reason ?? '@mx/plan could not be loaded.'))}` },
  };
}

/** Who resolved a step that needed the person: a later retry of it, or a "leave as is". */
function resolverOf(plan, step) {
  return plan.steps.find((s) => s.n > step.n && ((s.args?.retry && s.args.retry.of === step.id) || (s.tool === 'line.leaveAsIs' && s.args?.stepId === step.id))) ?? null;
}
const needsYou = (plan, s) => s.status === 'done' && s.result?.needsYou === true && !resolverOf(plan, s);

/** A step as Cockpit shows it: state, one sentence, the gap before it runs. */
export function stepView(root, plan, s, ops = REAL_PLAN_OPS) {
  const open = s.status === 'planned' || s.status === 'approved';
  const gap = open && CHANGE_TOOLS[s.tool] ? gapOf(root, s.tool, s.args, ops) : [];
  let state; let sentence;
  if (s.status === 'planned' && s.approval === 'needed') { state = 'waiting'; sentence = `Waiting for your approval: ${s.why}`; }
  else if (open) { state = 'ready'; sentence = `${s.approval === 'given' ? 'Approved, ready to run' : 'Ready to run'}: ${s.why}`; }
  else if (s.status === 'running') { state = 'running'; sentence = `Running: ${s.why}`; }
  else if (s.status === 'failed') { state = 'failed'; sentence = asSentence(s.error ?? `Step ${s.n} failed.`); }
  else if (s.status === 'skipped') { state = 'skipped'; sentence = `Skipped: ${s.why}`; }
  else {
    const r = s.result;
    const by = r?.needsYou ? resolverOf(plan, s) : null;
    if (r?.needsYou && !by) { state = 'needs-you'; sentence = asSentence(r.sentence); }
    else if (by) { state = 'done'; sentence = by.tool === 'line.leaveAsIs' ? `Left as it is in step ${by.n}: ${lower(asSentence(r.sentence))}` : `Tried again as step ${by.n}.`; }
    else {
      state = 'done';
      sentence = r && typeof r.sentence === 'string' ? asSentence(r.sentence)
        : s.tool === 'line.project' ? 'Read the Line view of the project.'
          : r && typeof r.command === 'string' ? `Ran construct ${r.command}, which ended with exit code ${r.exitCode}.` : `Done: ${s.why}`;
    }
  }
  return { id: s.id, n: s.n, tool: s.tool, args: s.args, why: s.why, kind: s.kind, state, sentence, gap, result: s.status === 'done' ? s.result ?? null : null, error: s.error ?? null };
}

/**
 * @param {{root: string, ops?: typeof REAL_PLAN_OPS, afterSave?: (root: string, file: string) => unknown,
 *   commands?: any, load?: (o: {root: string, registry: any}) => Promise<{api: any, store: {linked: boolean, sentence: string}}>,
 *   linkOptions?: object}} o `commands`: the construct.* registry (default: Construct's built-in commands; null for none).
 */
export function createLinePlanService({ root, ops = REAL_PLAN_OPS, afterSave, commands, load = loadPlanApi, linkOptions }) {
  /** @type {Promise<{api: any, store: {linked: boolean, sentence: string}, registry: any}> | null} */
  let ready = null;
  const init = () => (ready ??= (async () => {
    const cmd = commands === undefined ? await constructCommandTools().catch(() => null) : commands;
    const registry = createLinePlanRegistry({ root, ops, commands: cmd, afterSave });
    const loaded = await load({ root, registry, ...(linkOptions ? { linkOptions } : {}) });
    return { ...loaded, registry };
  })());
  let queue = Promise.resolve();
  const serial = (fn) => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };

  /** The current plan, or null when the session has none yet. */
  async function current(api) {
    const ses = await api.plan_session({ sessionId: SESSION_ID });
    if (!ses.ok || !ses.plan.session.planId) return null;
    const got = await api.plan_get({ planId: ses.plan.session.planId });
    return got.ok ? got.plan : null;
  }

  async function view(message) {
    const { api, store } = await init();
    const plan = await current(api);
    return {
      ok: /** @type {const} */ (true), sessionId: SESSION_ID, planId: plan?.id ?? null, version: plan?.version ?? null, status: plan?.status ?? null,
      steps: plan ? plan.steps.map((s) => stepView(root, plan, s, ops)) : [], store, ...(message ? { message: asSentence(message) } : {}),
    };
  }

  /** The plan steps join: the session's current plan, created (with the default goal) when there is none. */
  async function ensurePlan(api, by) {
    const plan = await current(api);
    if (plan && plan.status !== 'cancelled') return { ok: true, plan };
    const ses = await api.plan_session({ sessionId: SESSION_ID });
    const startedBy = by === 'agent' ? 'agent' : 'ui';
    const r = await api.plan_create({ goal: DEFAULT_GOAL, by, startedBy, ...(ses.ok ? { sessionId: SESSION_ID } : {}) });
    return r.ok ? { ok: true, plan: r.plan } : r;
  }

  /** Run a versioned plan call, reading the version again once on a conflict. */
  async function withVersion(api, planId, call) {
    let got = await api.plan_get({ planId });
    if (!got.ok) return got;
    let r = await call(got.plan);
    if (!r.ok && r.code === 'conflict') { got = await api.plan_get({ planId }); if (got.ok) r = await call(got.plan); }
    return r;
  }

  /**
   * @param {{tool?: unknown, args?: unknown, why?: unknown}} req @param {string} by
   */
  const addStep = (req, by) => serial(async () => {
    const { api, registry } = await init();
    const tool = typeof req?.tool === 'string' ? req.tool : '';
    let args = req?.args && typeof req.args === 'object' && !Array.isArray(req.args) ? { .../** @type {any} */ (req.args) } : {};
    let why = typeof req?.why === 'string' && req.why.trim() ? req.why.trim() : null;
    const spec = registry.list().find((t) => t.name === tool);
    if (!spec) return refusal('UNKNOWN_TOOL', tool ? `There is no tool named ${tool}; the Line tools are line.baseOn, line.promote, line.setPageProp, line.fix, line.setFragment, line.setBase, line.moveFile, line.createLayout, line.leaveAsIs and line.project` : 'Name the tool the step runs');
    const badArgs = () => {
      const parsed = spec.schema.safeParse(args);
      return parsed.success ? null : refusal('BAD_ARGS', `The arguments do not fit ${tool}: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'args'} ${i.message}`).join('; ')}`);
    };
    if (!args.retry) { const bad = badArgs(); if (bad) return bad; }
    // A change is planned (pure) before it joins the plan: a refusal is one sentence and starts nothing.
    if (CHANGE_TOOLS[tool] && !args.retry) {
      try {
        why = why ?? previewStep(root, tool, args, ops).summary;
      } catch (e) {
        if (/** @type {any} */ (e)?.name === 'LineOpError') return refusal(/** @type {any} */ (e).code, /** @type {any} */ (e).sentence);
        throw e;
      }
    }
    const has = await ensurePlan(api, by);
    if (!has.ok) return fromPlan(has);
    const plan = has.plan;
    if (args.retry) {
      const of = plan.steps.find((s) => s.id === args.retry.of);
      if (!of || of.tool !== tool || !needsYou(plan, of)) return refusal('NOT_RETRYABLE', `Step ${args.retry.of} is not a ${tool} step that needs you, so it cannot be tried again`);
      if (of.result.stopped) return refusal('STOPPED', `Trying step ${of.n} again did not pass more checks last time, so Line will not retry it; leave it as it is or change the request`);
      args = { ...of.args, retry: { of: of.id, passed: of.result.passed } };
      const bad = badArgs(); if (bad) return bad;
      why = why ?? `Try step ${of.n} again: ${lower(of.why)}`;
    }
    if (tool === 'line.leaveAsIs') {
      const of = plan.steps.find((s) => s.id === args.stepId);
      if (!of || !needsYou(plan, of)) return refusal('NOTHING_TO_LEAVE', `Step ${args.stepId} does not need you, so there is nothing to leave as it is`);
      why = why ?? `Carry on without fixing step ${of.n}.`;
    }
    if (CHANGE_TOOLS[tool] && !args.expect) args.expect = DEFAULT_EXPECT.map((c) => ({ ...c }));
    const r = await withVersion(api, plan.id, (p) => api.plan_add_step({ planId: p.id, version: p.version, by, step: { tool, args, why: why ?? `Run ${tool}.` } }));
    if (!r.ok) return fromPlan(r);
    const added = r.plan.steps[r.plan.steps.length - 1];
    return { ...(await view(r.message)), stepId: added.id };
  });

  const approve = (stepId, by) => serial(async () => {
    const { api } = await init();
    const plan = await current(api);
    if (!plan) return refusal('NO_PLAN', 'There is no plan yet, so there is nothing to approve');
    if (typeof stepId !== 'string' || !stepId) return refusal('BAD_ARGS', 'Name the step to approve');
    const r = await withVersion(api, plan.id, (p) => api.plan_approve({ planId: p.id, version: p.version, by, stepId }));
    return r.ok ? view(r.message) : fromPlan(r);
  });

  const runNext = (by, stepId) => serial(async () => {
    const { api } = await init();
    const plan = await current(api);
    if (!plan) return refusal('NO_PLAN', 'There is no plan yet, so nothing can run');
    const st = await api.plan_status({ planId: plan.id });
    const nextId = typeof stepId === 'string' && stepId ? stepId : st.ok ? st.state?.next : null;
    const next = plan.steps.find((s) => s.id === nextId);
    const blocked = plan.steps.find((s) => needsYou(plan, s));
    const resolves = next && ((next.args?.retry && next.args.retry.of === blocked?.id) || (next.tool === 'line.leaveAsIs' && next.args?.stepId === blocked?.id));
    if (blocked && !resolves) return refusal('NEEDS_YOU', `Step ${blocked.n} needs you first: ${lower(asSentence(blocked.result.sentence))}`);
    const r = await withVersion(api, plan.id, (p) => api.plan_run_next({ planId: p.id, version: p.version, by, ...(nextId ? { stepId: nextId } : {}) }));
    return r.ok ? view(r.message) : fromPlan(r);
  });

  return { view: () => serial(() => view()), addStep, approve, runNext, store: async () => (await init()).store };
}
