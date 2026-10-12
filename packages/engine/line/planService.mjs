// cp1 -- the one plan session per open project, shared by Cockpit (ui/server lineplanApi.mjs, as "ui") and agents
// (packages/mcp plan_* tools, as "agent"). It drives @mx/plan when the link is up (packages/line-links importLinked)
// and Line's built-in plan store otherwise (planFallback.mjs, same contract, same file), and says which in one
// sentence. Both keep the session in `<root>/line/plans/ses-cockpit.json`, written atomically by the plan store.
//
//   view()                  the session's current plan as Cockpit shows it (PlanView, contract.mjs)
//   addStep(req, by)        a step {tool, args, why?}; a change tool is planned first (a refusal never joins the plan),
//                           worded by its StagedChange summary and given the default checks (`expect`)
//   approve(stepId, by)     only a person approves a write (the plan store refuses an agent)
//   runNext(by, stepId?)    runs exactly one ready (approved) step; refuses while a step needs the person. When the
//                           step was a fix for a refused step (args.fixOf) and it landed, the refused step is re-checked
//                           (planned again and dry-run through the writer, nothing written): if it would land now, a
//                           retry of it joins the plan, waiting for the person's approval (owner decision c, 11 Oct)
//   addStep({fix}, by)      pilot-qwen-7b-r2 R1: add one of the typed fixes the last refused add offered, by its ref
//                           ("f1" is the recommended one) or its stable id ("TYPE_ERROR/route-props"); the fix's step
//                           is added as if it had been sent with tool and args. The offer lives until the next add.
//
// Nothing here writes a project file: a step's write happens only when the plan runner calls the registry
// (planTools.mjs -> applyChange -> Construct's transactional writer).
import { importLinked } from '../../line-links/index.mjs';
import { summarize } from '@line/summarize';
import { CHANGE_TOOLS, DEFAULT_EXPECT, REAL_PLAN_OPS, createLinePlanRegistry, constructCommandTools, gapOf, isDeferred, previewStep, requestOf, rootOf } from './planTools.mjs';
import { buildFacts } from './facts.mjs';
import { checkPre, conditionsOf, expectFor } from './conditions.mjs';
import { evaluate } from './expr.mjs';
import { createPlanRecorder } from './records.mjs';
import { createAtomicPlanWriter, createStaticPlanApi, lockPlanApi } from './planFallback.mjs';
import { isInsideWorkspace, readWorkspace } from './workspace.mjs';
import { createSessionTrace, refusalOfStep, matchFix, sourceOf, traceArgs } from './trace.mjs';
import { memoryOf, memoryBy } from './memory/index.mjs';
import { shapeRefusal, contextFor, withHints, badValueOf, badArgsField, targetOf, rulesCard, hintsJevOn, jevScores, renderQuestion, answerCall } from './hints.mjs';
import { rankLines } from './contextScore.mjs';

/** One session per open project, for now. */
export const SESSION_ID = 'ses-cockpit';
const SUFFIX = 'cockpit';
export const DEFAULT_GOAL = 'Change this project in Cockpit.';
/** How often a versioned call is tried when another process keeps changing the plan between read and write. */
const CONFLICT_TRIES = 8;

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
    return { api: lockPlanApi(m.createPlanApi({ registry, writer: m.createFileWriter(root), newId: () => SUFFIX }), { root, newId: () => SUFFIX }), store: { linked: true, sentence: 'Plans are kept by @mx/plan in line/plans of this project.' } };
  }
  return {
    api: createStaticPlanApi({ registry, writer: createAtomicPlanWriter(root), newId: () => SUFFIX }),
    store: { linked: false, sentence: `Line keeps plans in its built-in store in line/plans, because ${lower(String(/** @type {any} */ (linked).reason ?? '@mx/plan could not be loaded.'))}` },
  };
}

/** A line.amend fix of `step` that landed: it carried the refused change itself, so the refused step is done. */
const amendedBy = (s, step) => s.tool === 'line.amend' && s.args?.fixOf === step.id && s.status === 'done' && s.result?.apply?.ok === true && s.result?.needsYou !== true;

/** Who resolved a step that needed the person: a later retry of it, a "leave as is", or a fix that carried it (line.amend). */
function resolverOf(plan, step) {
  return plan.steps.find((s) => s.n > step.n && ((s.args?.retry && s.args.retry.of === step.id) || (s.tool === 'line.leaveAsIs' && s.args?.stepId === step.id) || amendedBy(s, step))) ?? null;
}
const needsYou = (plan, s) => s.status === 'done' && s.result?.needsYou === true && !resolverOf(plan, s);

/**
 * bench-gaps 1 (pilot H4): what to do about a step that needs the person, naming a typed fix only when one exists.
 * @param {any} step The blocked step (status done, result.needsYou).
 * @returns {string}
 */
export function needsYouSentence(step) {
  const r = step.result ?? {};
  const head = `Step ${step.n} needs you first: ${lower(asSentence(r.sentence ?? step.why))}`;
  const typed = (r.options ?? []).filter((o) => o.id === 'fix' && o.step);
  const retry = (r.options ?? []).some((o) => o.id === 'retry');
  if (typed.length) {
    return `${head} Add ${typed.length === 1 ? 'its fix' : `one of its ${typed.length} fixes`} (send {"fix":"f1"}; f1 is the recommended one)${retry ? ', try it again' : ''}, or leave it as it is with line.leaveAsIs {"stepId": "${step.id}"}.`;
  }
  const advice = (r.options ?? []).filter((o) => o.id === 'fix' && !o.step).map((o) => asSentence(o.sentence)).slice(0, 2).join(' ');
  return `${head} Construct has no fix it can make for this, so the person decides: ${advice ? `${lower(advice)} Then ` : ''}change the request and add it again${retry ? ', try the step again' : ''}, or leave it as it is with line.leaveAsIs {"stepId": "${step.id}"}.`;
}

/**
 * #885: what a builder may send for a step that needs it, as typed fixes (recommended first): each fix Construct
 * offered (with fixOf set), a retry when one is on offer, and leaving it as it is. Each gets a ref (f1..) like a
 * refused add's fixes, so {"fix": "f1"} adds it.
 * @param {any} step The step that needs the person.
 * @returns {{id: string, sentence: string, step: {tool: string, args: any}, rank: number, ref: string}[]}
 */
export function choicesOf(step) {
  const opts = step?.result?.options ?? [];
  const out = opts.filter((o) => o.id === 'fix' && o.step && typeof o.step.tool === 'string')
    .map((o) => ({ id: String(o.fixId ?? `fix:${o.step.tool}`), sentence: asSentence(o.sentence ?? `Add ${o.step.tool}.`), step: { tool: o.step.tool, args: { ...o.step.args, fixOf: step.id } } }));
  if (opts.some((o) => o.id === 'retry') && !step.result?.stopped) out.push({ id: 'retry', sentence: `Try step ${step.n} again.`, step: { tool: step.tool, args: { retry: { of: step.id } } } });
  out.push({ id: 'leave', sentence: `Leave step ${step.n} as it is and go on.`, step: { tool: 'line.leaveAsIs', args: { stepId: step.id } } });
  return out.map((f, i) => ({ ...f, rank: i + 1, ref: `f${i + 1}` }));
}

/**
 * #885: a refusal as every caller returns it: the planner's `sentence` stays, `text` is what a builder reads (wrong,
 * rule, choices or a correct call, how to apply) and `hint` its parts (hints.mjs shapeRefusal).
 * @param {any} r The refusal {ok: false, code, sentence, fixes?}.
 * @param {any} [req] The request it answers ({tool, args, fix?}).
 * @param {any[]} [fixes] The choices (default: r.fixes).
 * @param {string[]} [tools] The tool names (UNKNOWN_TOOL's nearest).
 * @param {string[]} [context] Lines about the refusal itself (#886).
 * @param {string} [example] A correct call that beats the tool's own example (#887).
 * @returns {any}
 */
export function shapedRefusal(r, req, fixes, tools, context, example) {
  const list = fixes ?? (Array.isArray(r.fixes) ? r.fixes : []);
  const { text, ...hint } = shapeRefusal({ code: r.code, sentence: r.sentence, tool: req?.tool, args: req?.args, fix: req?.fix, answer: req?.answer, option: req?.option, fixes: list, tools, context, example });
  return { ...r, ...(list.length ? { fixes: list } : {}), hint, text };
}

/**
 * A step as Cockpit shows it: state, one sentence, the gap before it runs.
 * @param {string} root The project root.
 * @param {any} plan The plan the step belongs to.
 * @param {any} s The step.
 * @param {any} [ops] The Line ops (real by default).
 * @returns {any} The step view.
 */
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
    // needs-fix: Construct refused the change and offers a fix that would land; otherwise the person decides (needs-you).
    if (r?.needsYou && !by) { state = r.apply && !r.apply.ok && r.options?.some((o) => o.id === 'fix' && o.step) ? 'needs-fix' : 'needs-you'; sentence = asSentence(r.sentence); }
    else if (by) {
      state = 'done';
      sentence = by.tool === 'line.leaveAsIs' ? `Left as it is in step ${by.n}: ${lower(asSentence(r.sentence))}`
        : by.tool === 'line.amend' ? `Saved together with its fix in step ${by.n}.` : `Tried again as step ${by.n}.`;
    }
    else {
      state = 'done';
      sentence = r && typeof r.sentence === 'string' ? asSentence(r.sentence)
        : s.tool === 'line.project' ? 'Read the Line view of the project.'
          : r && typeof r.command === 'string' ? `Ran construct ${r.command}, which ended with exit code ${r.exitCode}.` : `Done: ${s.why}`;
    }
  }
  const result = s.status === 'done' ? s.result ?? null : null;
  // cs1: the step's words are made and checked by the one summarizer; the tool call, ids and options are its details.
  const plain = summarize({ kind: 'plan-step', step: { id: s.id, n: s.n, tool: s.tool, args: s.args, state, sentence, result } });
  return { id: s.id, n: s.n, tool: s.tool, args: s.args, why: s.why, kind: s.kind, state, sentence: plain.sentences.join(' '), gap, result, error: s.error ?? null, plain };
}

/**
 * The plan service for one project: the session plan Cockpit and agents share, over @mx/plan when linked, else the static store.
 * @param {{root: string, ops?: typeof REAL_PLAN_OPS, afterSave?: (root: string, file: string) => unknown,
 *   commands?: any, load?: (o: {root: string, registry: any}) => Promise<{api: any, store: {linked: boolean, sentence: string}}>,
 *   linkOptions?: object, trace?: {id: string, record: (e: any) => any, problem: string|null} | null, records?: any, memory?: any,
 *   offers?: {get: () => any[] | null, set: (fixes: any[]) => void}, hintState?: {get: () => any, set: (v: any) => void},
 *   imports?: {question: (folder: string) => Promise<any>, answer: (by: string, folder: string, qid: string, oid: string) => Promise<any>}}} o `commands`: the
 *   construct.* registry (default: Construct's built-in commands; null for none). `trace` (cl1): where this session's
 *   typed trace goes (default `<state>/traces/<id>.jsonl`; null records nothing). `records` (expressions): where finished
 *   steps' training records go (default `<state>/records/plans.jsonl`, records.mjs; null records nothing). `memory` (im3):
 *   where plan feedback is remembered per step (default memory/index.mjs memoryOf(root); null remembers nothing).
 *   `offers` (R1): where the last refusal's typed fixes are kept between processes (default: in memory only).
 *   `hintState` (#886): where the refusal counts per code and target are kept between processes (default: in memory).
 *   `imports` (#887): the import agents an answer goes to (default: the folder's agent on disk, importAgentDisk.mjs).
 * @returns The plan service.
 */
export function createLinePlanService({ root, ops = REAL_PLAN_OPS, afterSave, commands, load = loadPlanApi, linkOptions, trace, records, memory, offers, hintState, imports }) {
  const tr = trace === undefined ? createSessionTrace(root, { sessionId: SESSION_ID }) : trace;
  const mem = memory === undefined ? memoryOf(root) : memory;
  /** im3: remember plan feedback (best effort: a memory that cannot be saved never stops the plan). */
  const remember = (step, proposal, outcome) => {
    if (!mem) return;
    Promise.resolve().then(() => mem.recordOutcome(step, { structure: null, slots: [], neighbourhood: [], ...proposal }, outcome)).catch(() => {});
  };
  const rec = records === undefined ? createPlanRecorder(root, { ops }) : records;
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
    // #888: the next open step's rules card (the 2-4 rules its tool and target layer must keep), before it runs.
    const open = plan?.steps.find((s) => s.status === 'planned' || s.status === 'approved');
    const card = open && CHANGE_TOOLS[open.tool] ? rulesCard(open.tool, open.args) : null;
    return {
      ok: /** @type {const} */ (true), sessionId: SESSION_ID, planId: plan?.id ?? null, version: plan?.version ?? null, status: plan?.status ?? null,
      steps: plan ? plan.steps.map((s) => stepView(root, plan, s, ops)) : [], store, ...(message ? { message: asSentence(message) } : {}),
      ...(card?.rules.length ? { next: { stepId: open.id, card } } : {}),
    };
  }

  /** The plan steps join: the session's current plan, created (with the default goal) when there is none. */
  async function ensurePlan(api, by) {
    const plan = await current(api);
    if (plan && plan.status !== 'cancelled') return { ok: true, plan };
    const ses = await api.plan_session({ sessionId: SESSION_ID });
    const startedBy = by === 'agent' ? 'agent' : 'ui';
    const r = await api.plan_create({ goal: DEFAULT_GOAL, by, startedBy, ...(ses.ok ? { sessionId: SESSION_ID } : {}) });
    if (!r.ok && r.code === 'conflict') { const made = await current(api); if (made && made.status !== 'cancelled') return { ok: true, plan: made }; }
    return r.ok ? { ok: true, plan: r.plan } : r;
  }

  /** Run a versioned plan call, reading the version again on a conflict (another process changed the plan meanwhile). */
  async function withVersion(api, planId, call) {
    let got = await api.plan_get({ planId });
    if (!got.ok) return got;
    let r = await call(got.plan);
    for (let tries = 1; tries < CONFLICT_TRIES && !r.ok && r.code === 'conflict'; tries += 1) { got = await api.plan_get({ planId }); if (!got.ok) break; r = await call(got.plan); }
    return r;
  }

  /**
   * @param {{tool?: unknown, args?: unknown, why?: unknown}} req @param {string} by
   */
  const addStepInner = async (req, by) => {
    const { api, registry } = await init();
    const tool = typeof req?.tool === 'string' ? req.tool : '';
    let args = req?.args && typeof req.args === 'object' && !Array.isArray(req.args) ? { .../** @type {any} */ (req.args) } : {};
    let why = typeof req?.why === 'string' && req.why.trim() ? req.why.trim() : null;
    const spec = registry.list().find((t) => t.name === tool);
    if (!spec) return refusal('UNKNOWN_TOOL', tool ? `There is no tool named ${tool}; the Line tools are ${registry.list().filter((t) => t.name.startsWith('line.')).map((t) => t.name).join(', ')}` : 'Name the tool the step runs');
    const badArgs = () => {
      const parsed = spec.schema.safeParse(args);
      return parsed.success ? null : refusal('BAD_ARGS', `The arguments do not fit ${tool}: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'args'} ${i.message}`).join('; ')}`);
    };
    if (!args.retry) { const bad = badArgs(); if (bad) return bad; }
    // A change is planned (pure) before it joins the plan: a refusal is one sentence and starts nothing.
    // An import step builds on the steps before it, so it is planned when it runs; only its folder is checked now.
    if (isDeferred(tool) && !args.retry) {
      try { rootOf(root, tool, args); } catch (e) { return refusal(/** @type {any} */ (e).code ?? 'BAD_FOLDER', /** @type {any} */ (e).sentence ?? 'The import folder must be inside the project'); }
    } else if (CHANGE_TOOLS[tool] && !args.retry) {
      try {
        const staged = previewStep(root, tool, args, ops);
        why = why ?? staged.summary;
        // cu6: a change outside the workspace folder can never land, so it never joins the plan (one sentence, as the writer says it).
        let folder = '';
        try { folder = readWorkspace(root).folder; } catch { folder = ''; }
        const outside = folder ? staged.files.find((f) => !isInsideWorkspace(folder, f.path)) : null;
        if (outside) return refusal('OUTSIDE_WORKSPACE', `Nothing was saved: ${outside.path} is outside your workspace folder ${folder}; it stays read-only.`);
      } catch (e) {
        if (/** @type {any} */ (e)?.name === 'LineOpError') {
          const r = refusal(/** @type {any} */ (e).code, /** @type {any} */ (e).sentence);
          const detail = /** @type {any} */ (e).detail;
          // bench-gaps 1: a refusal carries its typed fixes (contract.mjs RefusalFix): steps to add instead.
          // R1: each carries a short ref (f1 = rank 1) an agent sends back as {fix: "f1"} to add it.
          const fixes = Array.isArray(/** @type {any} */ (e).fixes) ? /** @type {any[]} */ ((/** @type {any} */ (e)).fixes).map((f, i) => ({ ...f, ref: `f${i + 1}` })) : [];
          return { ...r, ...(typeof detail === 'string' && detail ? { detail } : {}), ...(fixes.length ? { fixes } : {}) };
        }
        throw e;
      }
    }
    // Expressions: the tool's pre must hold on the project as it is (one sentence when not), and its post joins the
    // step's checks (expectFor). Read once per added step; a planner refusal above keeps its own sentence.
    let layout;
    if (CHANGE_TOOLS[tool] && !args.retry) {
      // An import or extract step is checked against its import folder's facts (its paths are folder-relative).
      let at = root;
      try { at = rootOf(root, tool, args); } catch { at = root; }
      const facts = buildFacts(at, { ops });
      layout = facts.project()?.layout;
      const why = checkPre(facts, tool, requestOf(args), layout);
      if (why) return refusal('PRE_FAILED', why);
    }
    const has = await ensurePlan(api, by);
    if (!has.ok) return fromPlan(has);
    const plan = has.plan;
    if (args.fixOf) {
      const of = plan.steps.find((s) => s.id === args.fixOf);
      if (!of || !needsYou(plan, of)) return refusal('NOTHING_TO_FIX', `Step ${args.fixOf} does not need a fix, so this step cannot be added for it`);
    }
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
    if (CHANGE_TOOLS[tool] && !args.expect) args.expect = expectFor(tool, requestOf(args), layout, DEFAULT_EXPECT);
    const r = await withVersion(api, plan.id, (p) => api.plan_add_step({ planId: p.id, version: p.version, by, step: { tool, args, why: why ?? `Run ${tool}.` } }));
    if (!r.ok) return fromPlan(r);
    const added = r.plan.steps[r.plan.steps.length - 1];
    return { ...(await view(r.message)), stepId: added.id };
  };

  // R1: the typed fixes the last refused add offered. In memory by default (Cockpit and MCP are long-lived, and a
  // refusal writes nothing into the project); a one-shot caller (plan-cli run per call) passes `offers` to keep them.
  /** @type {any[]} */
  let offered = [];
  const offer = (fixes) => {
    offered = fixes;
    try { offers?.set(fixes); } catch { /* best effort: the in-memory offer still answers this process */ }
  };
  const offeredNow = () => {
    try { const f = offers?.get(); if (Array.isArray(f)) return f; } catch { /* none kept */ }
    return offered;
  };
  // #886: how often each code was refused for each target in this plan (the context cap grows from 5 to 15 on a repeat).
  /** @type {Record<string, number>} */
  let seen = {};
  const seenNow = () => { try { const v = hintState?.get(); if (v && typeof v === 'object') return v; } catch { /* none kept */ } return seen; };
  const bump = (key) => {
    const s = { ...seenNow() };
    const n = s[key] ?? 0;
    s[key] = n + 1; seen = s;
    try { hintState?.set(s); } catch { /* best effort */ }
    return n;
  };
  /**
   * #885/#886: a refusal as it leaves the service: shaped (wrong, rule, choices, apply), each choice with why, effect and
   * its context lines, and `hintContext` (every candidate line with its static score, for the bench log and jev).
   */
  const say = async (r, req, fixes0, tools) => {
    const fixes = fixes0 ?? (Array.isArray(r.fixes) ? r.fixes : []);
    let plan = null; let fields = null;
    try {
      const { api, registry } = await init();
      plan = await current(api);
      fields = registry.list().find((t) => t.name === req?.tool)?.schema?.fields ?? null;
    } catch { /* context is best effort */ }
    const asked = badValueOf(r.code, { ...req, field: r.code === 'BAD_ARGS' ? badArgsField(r.sentence) : null })?.value ?? null;
    const target = targetOf(req?.args, null) ?? asked ?? req?.tool ?? '-';
    const repeat = bump(`${plan?.id ?? '-'}|${r.code}|${target}`);
    let ctx;
    try { ctx = contextFor(root, { code: r.code, tool: req?.tool, args: req?.args, fixes, detail: r.detail, plan, fields, repeat }); } catch { ctx = { lines: [], candidates: [], cap: 5, attempt: '' }; }
    // #890: only with the project's "jev picks context" switch on (and a measured win) does jev re-rank; else static.
    let via = 'static';
    if (ctx.candidates.length && hintsJevOn(root)) {
      const got = await jevScores(ctx.candidates, { attempt: ctx.attempt, code: r.code, said: r.sentence });
      if (got) {
        const by = new Map(ctx.candidates.map((l, i) => [l, got.scores[i]]));
        ctx = { ...ctx, lines: rankLines(ctx.candidates, { cap: ctx.cap, score: (l) => by.get(l) ?? 0 }).kept };
        via = 'jev';
      }
    }
    const hinted = withHints(fixes, { code: r.code, asked }, ctx);
    const out = shapedRefusal(r, req, hinted.fixes, tools, hinted.context);
    return { ...out, hintContext: { via, cap: ctx.cap, repeat, attempt: ctx.attempt, candidates: ctx.candidates, kept: ctx.lines.map((l) => ({ text: l.text, score: l.score, ref: l.ref })) } };
  };

  /** The fix `want` names (a ref like "f1", or a fix id), or a refusal that lists what can be picked. */
  const pickFix = (want) => {
    const fixes = offeredNow();
    const hit = fixes.find((f) => f.ref === want || f.id === want);
    if (hit?.step && typeof hit.step.tool === 'string') return { ok: /** @type {const} */ (true), fix: hit };
    if (!fixes.length) return refusal('UNKNOWN_FIX', `There is no fix ${want} to add: the last step added was not refused with fixes; add a step with its tool and args instead`);
    const list = fixes.slice(0, 8).map((f) => `${f.ref} (${String(f.sentence ?? f.id).replace(/[.?!]$/, '')})`).join('; ');
    return refusal('UNKNOWN_FIX', `There is no fix ${want}; the last refusal offered ${list}. Send one of those refs, for example {"fix": "${fixes[0].ref}"}`);
  };

  // #887: an import question is answered through the plan API in the same shape as a fix: {answer, option, folder}.
  /** @type {Map<string, any>} */
  const agents = new Map();
  const agentOf = async (folder) => {
    if (!agents.has(folder)) {
      const [{ createImportAgentOnDisk }, { verifyImport, lineBaseline }] = await Promise.all([import('./importAgentDisk.mjs'), import('./importVerify.mjs')]);
      agents.set(folder, createImportAgentOnDisk({ root, folder, planService: service, verify: verifyImport, baseline: lineBaseline }));
    }
    return agents.get(folder);
  };
  const imp = imports ?? {
    question: async (folder) => (await (await agentOf(folder)).view())?.waiting?.question ?? null,
    answer: async (by, folder, qid, oid) => (await agentOf(folder)).answer(by, qid, oid),
  };
  const answerQuestion = async (req, by) => {
    const folder = typeof req.folder === 'string' && req.folder.trim() ? req.folder.trim() : '';
    const qid = String(req.answer); const oid = typeof req.option === 'string' ? req.option : '';
    if (!folder) return shapedRefusal(refusal('BAD_ARGS', 'Name the import folder the question belongs to (folder)'), { answer: qid, option: oid }, [], undefined, undefined, answerCall(qid, oid || '<option id>', 'src/alerts'));
    let r;
    try { r = await imp.answer(by, folder, qid, oid); } catch (e) { r = refusal(/** @type {any} */ (e)?.code ?? 'BAD_FOLDER', /** @type {any} */ (e)?.sentence ?? String(/** @type {any} */ (e)?.message ?? e)); }
    if (r && r.ok === false) {
      let open = null;
      try { open = await imp.question(folder); } catch { open = null; }
      return shapedRefusal(r, { answer: qid, option: oid }, [], undefined, open ? renderQuestion(open, { folder }) : [], open ? answerCall(open.id, open.recommended ?? open.options[0]?.id, folder) : undefined);
    }
    return { ok: /** @type {const} */ (true), answered: { question: qid, option: oid, folder }, import: r };
  };

  /** cl1: record a step or a refusal in the session trace; with args.fixOf, also which offered fix was picked. */
  // An answer is not queued with the plan's own calls: the import agent it reaches adds and runs plan steps itself.
  const addStep = (req0, by) => (typeof req0?.answer === 'string' && req0.answer.trim() ? answerQuestion(req0, by) : serial(async () => {
    const want = typeof req0?.fix === 'string' && req0.fix.trim() ? req0.fix.trim() : null;
    const picked = want ? pickFix(want) : null;
    if (picked && !picked.ok) {
      if (tr) tr.record({ kind: 'refusal', by: String(by), tool: '(fix)', stepId: null, args: { fix: want }, source: sourceOf(picked.code), code: String(picked.code), sentence: picked.sentence, rules: [], files: [], fixes: [] });
      // #885: the choices on offer are shown again, so the next call can pick one.
      return say(picked, { fix: want }, offeredNow());
    }
    // A picked fix is its step, sent as if with tool and args (a tool or args sent alongside are ignored).
    const req = picked?.ok ? { tool: picked.fix.step.tool, args: picked.fix.step.args, why: typeof req0?.why === 'string' && req0.why.trim() ? req0.why : picked.fix.sentence } : req0;
    const r0 = await addStepInner(req, by);
    let r = r0;
    if (!r0.ok) {
      const own = Array.isArray(/** @type {any} */ (r0).fixes) ? /** @type {any} */ (r0).fixes : [];
      // A small model that sends a fix's ref or a path as the tool name ("fixes[0].step", "f1") meant the offered fix.
      const meantFix = !own.length && /** @type {any} */ (r0).code === 'UNKNOWN_TOOL' && /fix|^f\d+$/i.test(String(req?.tool ?? '')) ? offeredNow() : [];
      const { registry } = await init();
      r = await say(r0, req, own.length ? own : meantFix, registry.list().map((t) => t.name).filter((n) => n.startsWith('line.') && !n.startsWith('line.import.')));
      if (!meantFix.length) offer(own);
    } else offer([]);
    if (!tr) return r;
    const tool = typeof req?.tool === 'string' && req.tool ? req.tool : '(none)';
    const args = traceArgs(req?.args);
    if (!r.ok) {
      const no = /** @type {{code: any, sentence: string}} */ (/** @type {any} */ (r));
      tr.record({ kind: 'refusal', by: String(by), tool, stepId: null, args, source: sourceOf(no.code), code: String(no.code), sentence: no.sentence, rules: [], files: [], fixes: [] });
      return r;
    }
    const fixOf = typeof args.fixOf === 'string' ? args.fixOf : null;
    const retryOf = req?.args?.retry?.of ?? null;
    tr.record({ kind: 'step', by: String(by), tool, stepId: r.stepId, args, fixOf, retryOf });
    if (fixOf) {
      const of = r.steps.find((s) => s.id === fixOf);
      const fixId = matchFix(of, tool, req.args);
      tr.record({ kind: 'fix-picked', by: String(by), tool, stepId: r.stepId, fixOf, fixId });
      const offered = (of?.result?.options ?? []).filter((o) => o.id === 'fix' && o.fixId).map((o) => String(o.fixId));
      if (fixId) remember('plan.fix', { intent: of?.tool ?? tool, options: offered, proposed: offered[0] ?? null }, { kind: 'fix-picked', chosen: fixId, by: memoryBy(String(by)) });
    }
    return r;
  }));

  const approve = (stepId, by) => serial(async () => {
    const { api } = await init();
    const plan = await current(api);
    if (!plan) return say(refusal('NO_PLAN', 'There is no plan yet, so there is nothing to approve'));
    if (typeof stepId !== 'string' || !stepId) return say(refusal('BAD_ARGS', 'Name the step to approve'), { tool: 'line.leaveAsIs', args: {} });
    const r = await withVersion(api, plan.id, (p) => api.plan_approve({ planId: p.id, version: p.version, by, stepId }));
    if (r.ok) {
      const tool = plan.steps.find((s) => s.id === stepId)?.tool;
      if (tool) remember('plan.step', { intent: tool, options: [tool], proposed: tool }, { kind: 'approved', chosen: tool, by: memoryBy(String(by)) });
    }
    return r.ok ? view(r.message) : say(fromPlan(r));
  });

  const runNextInner = async (by, stepId) => {
    const { api } = await init();
    const plan = await current(api);
    if (!plan) return say(refusal('NO_PLAN', 'There is no plan yet, so nothing can run'));
    const st = await api.plan_status({ planId: plan.id });
    let nextId = typeof stepId === 'string' && stepId ? stepId : st.ok ? st.state?.next : null;
    const blocked = plan.steps.find((s) => needsYou(plan, s));
    // While a step needs the person, only what answers it runs: a retry of it, a fix for it (args.fixOf), or "leave as is".
    const answers = (x) => Boolean(x && blocked && ((x.args?.retry && x.args.retry.of === blocked.id) || x.args?.fixOf === blocked.id || (x.tool === 'line.leaveAsIs' && x.args?.stepId === blocked.id)));
    // bench-gaps: a step added before the answer waits behind it; the ready answer runs first instead of refusing.
    if (blocked && !(typeof stepId === 'string' && stepId) && !answers(plan.steps.find((s) => s.id === nextId))) {
      const answer = plan.steps.find((s) => (s.status === 'approved' || (s.status === 'planned' && s.approval !== 'needed')) && answers(s));
      if (answer) nextId = answer.id;
    }
    const next = plan.steps.find((s) => s.id === nextId);
    const resolves = answers(next);
    if (blocked && !resolves) {
      const choices = choicesOf(blocked);
      offer(choices);
      return say(refusal('NEEDS_YOU', needsYouSentence(blocked)), { tool: blocked.tool, args: {} }, choices);
    }
    const r = await withVersion(api, plan.id, (p) => api.plan_run_next({ planId: p.id, version: p.version, by, ...(nextId ? { stepId: nextId } : {}) }));
    if (!r.ok) return say(fromPlan(r));
    const recheck = next?.args?.fixOf ? await recheckAfterFix(api, String(next.args.fixOf), next.id, by) : null;
    const out = await view(r.message);
    return recheck ? { ...out, recheck } : out;
  };

  /**
   * After a fix step (args.fixOf) ran: if it landed, plan the step it fixed again and dry-run it through the writer
   * (nothing written). If it would land now, add a retry of it, waiting for the person's approval; otherwise the
   * step keeps needing a fix. Returns the sentence for the plan's message, or null when there is nothing to say.
   */
  async function recheckAfterFix(api, ofId, fixId, by) {
    const plan = await current(api);
    const fix = plan?.steps.find((s) => s.id === fixId);
    const of = plan?.steps.find((s) => s.id === ofId);
    if (!plan || !fix || !of || fix.status !== 'done' || !fix.result?.apply?.ok || !needsYou(plan, of) || !CHANGE_TOOLS[of.tool]) return null;
    const req = Object.fromEntries(Object.entries(of.args ?? {}).filter(([k]) => !['expect', 'retry', 'fixOf'].includes(k)));
    let verdict;
    try {
      const staged = previewStep(root, of.tool, req, ops);
      verdict = typeof ops.checkChange === 'function' ? ops.checkChange(rootOf(root, of.tool, req), staged) : { ok: true, sentence: '' };
    } catch (e) {
      verdict = { ok: false, sentence: /** @type {any} */ (e)?.sentence ?? 'it can no longer be planned.' };
    }
    if (!verdict.ok) return `The fix landed, but step ${of.n} still cannot land: ${lower(asSentence(String(verdict.sentence).replace(/^Nothing would be saved: /, '')))}`;
    if (of.result?.stopped) return `The fix landed; step ${of.n} would land now, but it was stopped after a retry, so add it again yourself.`;
    const args = { ...of.args, retry: { of: of.id, passed: of.result.passed } };
    const r = await withVersion(api, plan.id, (p) => api.plan_add_step({ planId: p.id, version: p.version, by, step: { tool: of.tool, args, why: `Try step ${of.n} again: ${lower(of.why)}` } }));
    if (!r.ok) return `The fix landed; step ${of.n} would land now, but it could not be added again: ${lower(asSentence(r.reason ?? 'the plan refused it'))}`;
    return `The fix landed, and step ${of.n} plans clean now: it waits for your approval again.`;
  }

  /** Expressions: one training record per finished change step (records.mjs), with its pre on the state before. */
  const recordFinished = async (state, open) => {
    const plan = await current((await init()).api);
    for (const s of plan?.steps ?? []) {
      if (!open.has(s.id) || !CHANGE_TOOLS[s.tool] || s.status !== 'done') continue;
      const c = conditionsOf(s.tool, requestOf(s.args), state.project?.layout);
      // Cockpit's plans carry the default goal; then the step's own why is what the person asked for.
      const intent = plan.goal === DEFAULT_GOAL ? s.why : plan.request ?? plan.goal;
      rec.record({ plan, step: s, before: state, intent, pre: c ? { expr: c.pre, ok: evaluate(state.facts, c.pre).ok } : null });
    }
  };

  /** cl1: record what ran (its outcome) and, when Construct refused it, the refusal with the typed fixes it offered. */
  const runNext = (by, stepId) => serial(async () => {
    const before = tr || rec ? await current((await init()).api) : null;
    const open = new Set((before?.steps ?? []).filter((s) => s.status === 'planned' || s.status === 'approved').map((s) => s.id));
    const state = rec && open.size ? rec.snapshot() : null;
    const r0 = await runNextInner(by, stepId);
    // #885: a step Construct refused when it ran offers its choices like a refused add: {"fix": "f1"} adds one.
    let r = r0;
    const stuck = r0.ok ? r0.steps.find((s) => open.has(s.id) && (s.state === 'needs-fix' || s.state === 'needs-you')) : null;
    if (stuck) {
      const choices = choicesOf(stuck);
      offer(choices);
      const said = await say({ ok: false, code: stuck.state === 'needs-fix' ? 'NEEDS_FIX' : 'NEEDS_YOU', sentence: stuck.sentence, detail: stuck.result?.apply?.detail ?? null }, { tool: stuck.tool, args: stuck.args }, choices);
      r = { ...r0, needs: { stepId: stuck.id, fixes: said.fixes, hint: said.hint, text: said.text, hintContext: said.hintContext } };
    }
    if (rec && state && r.ok) await recordFinished(state, open);
    if (!tr) return r;
    if (!r.ok) {
      const no = /** @type {{code: any, sentence: string}} */ (/** @type {any} */ (r));
      const tool = before?.steps.find((s) => s.id === stepId)?.tool ?? '(plan)';
      tr.record({ kind: 'refusal', by: String(by), tool, stepId: typeof stepId === 'string' ? stepId : null, source: sourceOf(no.code), code: String(no.code), sentence: no.sentence, rules: [], files: [], fixes: [] });
      return r;
    }
    for (const s of r.steps.filter((x) => open.has(x.id) && x.state !== 'waiting' && x.state !== 'ready')) {
      const res = s.result && typeof s.result === 'object' ? s.result : null;
      const ok = s.state === 'done' && res?.needsYou !== true;
      const passed = Number.isInteger(res?.passed) ? res.passed : ok ? 1 : 0;
      const total = Number.isInteger(res?.total) ? res.total : 1;
      if (res && res.needsYou === true && res.apply) tr.record({ by: String(by), ...refusalOfStep(s) });
      if (res && res.needsYou === true) remember('plan.step', { intent: s.tool, options: [s.tool], proposed: s.tool }, { kind: 'refused', chosen: null, by: 'line' });
      tr.record({ kind: 'outcome', by: String(by), tool: s.tool, stepId: s.id, ok, passed, total, state: s.state, sentence: s.sentence });
    }
    return r;
  });

  const service = { view: () => serial(() => view()), addStep, approve, runNext, store: async () => (await init()).store, trace: tr, records: rec };
  return service;
}
