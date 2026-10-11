// cp1 -- Line's built-in plan store: the static fallback when @mx/plan cannot be linked (packages/line-links). It
// keeps the same contract for the calls Cockpit and agents use (plan_create, plan_get, plan_session, plan_add_step,
// plan_approve, plan_run_next, plan_status) and writes the same file, `<root>/line/plans/<sessionId>.json` (tmp +
// rename, plus `writes.jsonl`), so a project moves between the two without losing its plans. Same rules: only a
// person approves a write, every mutation takes the plan's version, one step runs at a time, each call answers
// `{ok: true, plan, message}` or `{ok: false, code, reason}` with one plain-English sentence.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PEOPLE = ['user', 'ui', 'chat'];
const isPerson = (by) => PEOPLE.includes(by);
const addedByOf = (by) => (isPerson(by) ? 'user' : by === 'agent' || by === 'import' ? 'agent' : by === 'jev' || by === 'qwen' ? by : 'static');
const SENTENCE = /^[A-Z0-9"'(][^\n]*[.?!]$/;
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const refuse = (code, reason, version) => (version === undefined ? { ok: false, code, reason } : { ok: false, code, reason, version });
const sentence = (s) => { const t = String(s).trim().replace(/\s+/g, ' '); const c = t.charAt(0).toUpperCase() + t.slice(1); return /[.?!]$/.test(c) ? c : `${c}.`; };

/**
 * The file writer @mx/plan's createFileWriter is, in plain Node: atomic (tmp + rename) and logged.
 * @param {string} root The project root.
 */
export function createAtomicPlanWriter(root) {
  const dir = path.join(root, 'line', 'plans');
  const logFile = path.join(dir, 'writes.jsonl');
  const fileOf = (sid) => { if (!ID.test(sid)) throw new Error(`"${sid}" is not a session id Line can store.`); return path.join(dir, `${sid}.json`); };
  return {
    async read(sid) {
      try { return JSON.parse(fs.readFileSync(fileOf(sid), 'utf8')); } catch (e) { if (/** @type {any} */ (e).code === 'ENOENT') return null; throw e; }
    },
    async write(doc, note) {
      fs.mkdirSync(dir, { recursive: true });
      const file = fileOf(doc.session.id);
      const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
      fs.writeFileSync(tmp, `${JSON.stringify(doc, null, 2)}\n`, 'utf8');
      fs.renameSync(tmp, file);
      fs.appendFileSync(logFile, `${JSON.stringify({ at: new Date().toISOString(), sessionId: doc.session.id, ...note })}\n`, 'utf8');
    },
    async list() {
      try { return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)).sort(); } catch { return []; }
    },
  };
}

/** Why `step` cannot run now, or null (the same words as @mx/plan's waitReason). */
function waitReason(plan, step) {
  if (step.status !== 'planned' && step.status !== 'approved') return `Step ${step.n} is ${step.status}.`;
  if (step.approval === 'needed') return `Step ${step.n} (${step.tool}) writes, so it waits for a person to approve it.`;
  for (const d of step.dependsOn ?? []) {
    const dep = plan.steps.find((s) => s.id === d);
    if (!dep) return `Step ${step.n} depends on ${d}, which is gone.`;
    if (dep.status !== 'done') return `Step ${step.n} waits for step ${dep.n}, which is ${dep.status}.`;
  }
  return null;
}
const canRun = (s) => s === 'draft' || s === 'approved' || s === 'running';

/**
 * The static plan API.
 * @param {{registry: import('../../line-links/contracts').PlanRegistry, writer: ReturnType<typeof createAtomicPlanWriter>,
 *   now?: () => string, newId?: () => string}} o
 */
export function createStaticPlanApi(o) {
  const now = o.now ?? (() => new Date().toISOString());
  const newId = o.newId ?? (() => crypto.randomUUID().slice(0, 8));
  const sessionOf = (planId) => { const m = /^plan-([A-Za-z0-9_]+)-\d+$/.exec(planId); return m ? `ses-${m[1]}` : null; };
  let queue = Promise.resolve();
  const locked = (fn) => { const run = queue.then(fn, fn); queue = run.catch(() => {}); return run; };
  const notFound = (id) => refuse('not_found', `There is no plan ${id}; plan_list shows the plans.`);
  const load = async (planId) => { const sid = sessionOf(planId); const d = sid ? await o.writer.read(sid) : null; return d?.plans.find((p) => p.id === planId) ?? null; };

  function mutate(a, fn, check = true) {
    const sid = sessionOf(a.planId);
    if (!sid) return Promise.resolve(notFound(a.planId));
    return locked(async () => {
      const doc = await o.writer.read(sid);
      const i = doc ? doc.plans.findIndex((p) => p.id === a.planId) : -1;
      if (!doc || i < 0) return notFound(a.planId);
      const stored = doc.plans[i];
      if (check && a.version !== stored.version) return refuse('conflict', `The plan changed since you read it (you sent version ${a.version}, it is at ${stored.version}); read it again and retry.`, stored.version);
      const plan = structuredClone(stored);
      const r = fn(plan);
      if ('ok' in r) return r;
      plan.steps.forEach((s, k) => { s.n = k + 1; });
      plan.version += 1;
      const change = sentence(r.change);
      plan.history.push({ at: now(), by: a.by, change });
      await o.writer.write({ ...doc, plans: doc.plans.map((p, j) => (j === i ? plan : p)) }, { planId: plan.id, planVersion: plan.version, by: a.by, change });
      return { ok: true, plan, message: change };
    });
  }

  function makeStep(p, input, by) {
    if (!input || typeof input.tool !== 'string') return refuse('invalid', 'The step is not well formed: tool is missing.');
    const spec = o.registry.list().find((t) => t.name === input.tool);
    if (!spec) return refuse('invalid', `There is no tool named ${input.tool}, so nothing changed.`);
    const parsed = spec.schema.safeParse(input.args ?? {});
    if (!parsed.success) return refuse('invalid', `The arguments do not fit ${input.tool}: ${parsed.error.issues.map((x) => `${x.path.join('.') || 'args'} ${x.message}`).join('; ')}.`);
    if (input.kind !== undefined && input.kind !== spec.kind) return refuse('invalid', `The tool ${input.tool} is marked ${spec.kind}, but the step says ${input.kind}.`);
    if (typeof input.why !== 'string' || !SENTENCE.test(input.why.trim())) return refuse('invalid', "The step's why must be one plain-English sentence that starts with a capital letter and ends with a full stop.");
    let k = p.steps.length + 1; while (p.steps.some((s) => s.id === `s${k}`)) k += 1;
    const id = input.id ?? `s${k}`;
    if (!ID.test(id) || p.steps.some((s) => s.id === id)) return refuse('invalid', `"${id}" is not a free step id in this plan.`);
    return { id, n: p.steps.length + 1, tool: input.tool, args: input.args ?? {}, why: input.why.trim(), kind: spec.kind, status: 'planned', approval: spec.kind === 'write' && !p.auto ? 'needed' : 'none', addedBy: addedByOf(by) };
  }

  const summary = (d, p) => ({ planId: p.id, sessionId: d.session.id, title: d.session.title, goal: p.goal, status: p.status, version: p.version, steps: p.steps.length });
  const state = (p) => {
    const counts = { planned: 0, approved: 0, running: 0, done: 0, failed: 0, skipped: 0 };
    for (const s of p.steps) counts[s.status] += 1;
    const open = p.steps.filter((s) => s.status === 'planned' || s.status === 'approved');
    return { status: p.status, version: p.version, counts, next: canRun(p.status) && !counts.running ? open.find((s) => !waitReason(p, s))?.id ?? null : null, waiting: open.flatMap((s) => { const r = waitReason(p, s); return r ? [{ stepId: s.id, reason: r }] : []; }) };
  };

  return {
    async plan_create(a) {
      if (!SENTENCE.test(String(a.goal ?? '').trim())) return refuse('invalid', 'The goal must be one plain-English sentence that starts with a capital letter and ends with a full stop.');
      if (a.auto && !isPerson(a.by)) return refuse('forbidden', 'Only a person can turn Auto on, so the plan was not created; leave auto out and ask the user to approve writes.');
      return locked(async () => {
        let prior = null; let suffix;
        if (a.sessionId !== undefined) {
          const m = /^ses-([A-Za-z0-9_]+)$/.exec(a.sessionId);
          prior = m ? await o.writer.read(a.sessionId) : null;
          if (!prior) return refuse('not_found', `There is no session ${a.sessionId}.`);
          suffix = m[1];
        } else suffix = newId();
        const planId = `plan-${suffix}-${(prior?.plans.length ?? 0) + 1}`;
        const title = a.title ?? a.goal.trim().replace(/[.?!]$/, '');
        const session = prior ? { ...prior.session, planId } : { id: `ses-${suffix}`, title, startedBy: a.startedBy ?? (isPerson(a.by) ? a.by : 'agent'), planId, at: now() };
        const plan = { id: planId, sessionId: session.id, goal: a.goal.trim(), request: a.request ?? a.goal.trim(), steps: [], status: 'draft', version: 1, auto: a.auto ?? false, history: [] };
        for (const s of a.steps ?? []) { const st = makeStep(plan, s, a.by); if ('ok' in st) return refuse(st.code, `The plan was not created: ${st.reason}`); plan.steps.push(st); }
        const change = `Created the plan with ${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'}.`;
        plan.history.push({ at: now(), by: a.by, change });
        await o.writer.write({ session, plans: [...(prior?.plans ?? []), plan], question: prior?.question ?? null }, { planId, planVersion: 1, by: a.by, change });
        return { ok: true, plan, message: `Created plan ${planId} in session ${session.id}.` };
      });
    },
    async plan_get(a) { const p = await load(a.planId); return p ? { ok: true, plan: p, message: `Plan ${p.id} is ${p.status} at version ${p.version}.` } : notFound(a.planId); },
    async plan_session(a) {
      const d = /^ses-[A-Za-z0-9_]+$/.test(a.sessionId) ? await o.writer.read(a.sessionId) : null;
      if (!d) return refuse('not_found', `There is no session ${a.sessionId}.`);
      const plans = [...d.plans].sort((x, y) => Number(y.id === d.session.planId) - Number(x.id === d.session.planId)).map((p) => summary(d, p));
      return { ok: true, plan: { session: d.session, plans, question: d.question ?? null }, message: `Session ${d.session.id} has ${plans.length} plan${plans.length === 1 ? '' : 's'}.` };
    },
    plan_add_step: (a) => mutate(a, (p) => {
      if (p.status === 'cancelled') return refuse('state', 'The plan is cancelled, so no step can be added; start a new plan with plan_create.');
      const s = makeStep(p, a.step, a.by);
      if ('ok' in s) return s;
      p.steps.push(s);
      const reopened = p.status === 'done';
      if (reopened) p.status = 'running';
      return { change: `${reopened ? 'Reopened the plan and added' : 'Added'} step ${s.n} (${s.tool}): ${s.why}` };
    }),
    plan_approve: (a) => mutate(a, (p) => {
      if (p.status === 'done' || p.status === 'cancelled') return refuse('state', `The plan is ${p.status}; there is nothing to approve.`);
      const steps = a.stepId === undefined ? p.steps.filter((s) => s.status === 'planned') : p.steps.filter((s) => s.id === a.stepId);
      if (a.stepId !== undefined && !steps.length) return refuse('not_found', `This plan has no step ${a.stepId}.`);
      for (const s of steps) if (s.status !== 'planned') return refuse('state', `Step ${s.n} is ${s.status}; only planned steps can be approved.`);
      const writes = steps.filter((s) => s.approval === 'needed');
      if (writes.length && !isPerson(a.by)) return refuse('forbidden', `Step ${writes.map((s) => s.n).join(', ')} writes, and only a person can approve a write; ask the user to approve it in Line, or to turn Auto on.`);
      for (const s of steps) { s.status = 'approved'; if (s.approval === 'needed') s.approval = 'given'; }
      if (a.stepId === undefined && p.status === 'draft') p.status = 'approved';
      return { change: a.stepId === undefined ? `Approved ${steps.length} steps` : `Approved step ${steps[0].n} (${steps[0].tool})` };
    }),
    async plan_run_next(a) {
      let picked;
      const started = await mutate(a, (p) => {
        if (!canRun(p.status)) return refuse('state', p.status === 'failed' ? 'A step failed; fix it with plan_update_step or skip it, then run again.' : `The plan is ${p.status}, so no step runs.`);
        const running = p.steps.find((s) => s.status === 'running');
        if (running) return refuse('state', `Step ${running.n} is still running; one step runs at a time.`);
        if (a.stepId !== undefined) {
          const want = p.steps.find((s) => s.id === a.stepId);
          if (!want) return refuse('not_found', `This plan has no step ${a.stepId}.`);
          const why = waitReason(p, want);
          if (why) return refuse('state', `Step ${want.n} is not ready: ${why}`);
        }
        const ready = p.steps.find((s) => (a.stepId === undefined || s.id === a.stepId) && (s.status === 'planned' || s.status === 'approved') && !waitReason(p, s));
        if (!ready) {
          const waiting = p.steps.flatMap((s) => (s.status === 'planned' || s.status === 'approved' ? [waitReason(p, s)] : []));
          return refuse('state', waiting.length ? `No step is ready: ${waiting.join(' ')}` : 'Every step has finished; add a step to do more.');
        }
        ready.status = 'running';
        p.status = 'running';
        picked = structuredClone(ready);
        return { change: `Started step ${ready.n} (${ready.tool}): ${ready.why}` };
      });
      if (!started.ok || !picked) return started;
      let result; let error;
      try { result = await o.registry.call(picked.tool, picked.args); result = result === undefined ? null : JSON.parse(JSON.stringify(result)); } catch (e) { error = sentence(`The tool ${picked.tool} failed: ${e instanceof Error ? e.message : String(e)}`); }
      return mutate({ planId: a.planId, version: 0, by: 'line' }, (p) => {
        const s = p.steps.find((x) => x.id === picked.id);
        if (!s) return refuse('state', `Step ${picked.id} disappeared while it ran.`);
        if (error !== undefined) { s.status = 'failed'; s.error = error; if (p.status === 'running') p.status = 'failed'; return { change: `Step ${s.n} (${s.tool}) failed` }; }
        s.status = 'done'; s.result = result;
        if (p.status === 'running' && p.steps.every((x) => x.status === 'done' || x.status === 'skipped')) p.status = 'done';
        return { change: `Finished step ${s.n} (${s.tool})` };
      }, false);
    },
    async plan_status(a) {
      const p = await load(a.planId);
      if (!p) return notFound(a.planId);
      const st = state(p);
      return { ok: true, plan: p, state: st, message: `The plan is ${p.status} at version ${p.version}, with ${st.counts.done + st.counts.skipped} of ${p.steps.length} steps finished.${st.waiting.map((w) => ` ${w.reason}`).join('')}` };
    },
  };
}
