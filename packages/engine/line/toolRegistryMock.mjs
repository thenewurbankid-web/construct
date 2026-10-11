// cu3 -- the tool registry's mock: the real registry (toolRegistry.mjs) over the contract's in-memory LineOps
// (mock.mjs) and an in-memory plan service with the plan's rules: a write step waits for approval, only a person
// approves, only an approved step runs, and running a change goes through the mock's applyChange (the only thing
// that changes its files). Build a surface against it before the real plan store is up.
import { createMockLineOps } from './mock.mjs';
import { createToolRegistry, lineHandlers, entryById } from './toolRegistry.mjs';

const ROOT = '/mock';
const PLAN_OPS = { 'line.baseOn': 'planBaseOn', 'line.promote': 'planPromote', 'line.setPageProp': 'planSetProp', 'line.setFragment': 'planSetFragment' };

/** An in-memory plan service (planService.mjs's shape: view, addStep, approve, runNext). */
export function createMockPlanService(ops = createMockLineOps()) {
  /** @type {{id: string, n: number, tool: string, args: any, why: string, kind: 'read'|'write', status: string, approval: 'needed'|'given'|'none', result: any}[]} */
  const steps = [];
  const view = (message) => ({
    ok: /** @type {const} */ (true), sessionId: 'ses-cockpit', planId: steps.length ? 'plan-mock' : null, version: steps.length || null, status: steps.length ? 'open' : null,
    steps: steps.map((s) => ({
      id: s.id, n: s.n, tool: s.tool, args: s.args, why: s.why, kind: s.kind,
      state: s.status === 'done' ? 'done' : s.approval === 'needed' ? 'waiting' : 'ready',
      sentence: s.status === 'done' ? (s.result?.sentence ?? `Done: ${s.why}`) : s.approval === 'needed' ? `Waiting for your approval: ${s.why}` : `Ready to run: ${s.why}`,
      gap: [], result: s.status === 'done' ? s.result : null, error: null,
    })),
    store: { linked: false, sentence: 'Line keeps this plan in memory (mock).' },
    ...(message ? { message } : {}),
  });
  return {
    files: () => ops.files(),
    view: async () => view(),
    async addStep({ tool, args = {}, why }, by) {
      const e = entryById(tool);
      if (!e || !e.surfaces.plan) return { ok: false, code: 'UNKNOWN_TOOL', sentence: `There is no plan tool named ${tool}.` };
      let summary = why;
      if (PLAN_OPS[tool]) {
        try { summary = summary ?? ops[PLAN_OPS[tool]](ROOT, args).summary; } catch (err) { return { ok: false, code: /** @type {any} */ (err).code ?? 'REFUSED', sentence: /** @type {any} */ (err).sentence ?? 'That change cannot be planned.' }; }
      }
      const id = `step-${steps.length + 1}`;
      steps.push({ id, n: steps.length + 1, tool, args, why: summary ?? `Run ${tool}.`, kind: e.kind, status: 'planned', approval: e.kind === 'write' ? 'needed' : 'none', result: null });
      return { ...view(`Added step ${steps.length} (by ${by}).`), stepId: id };
    },
    async approve(stepId, by) {
      if (by === 'agent') return { ok: false, code: 'PLAN_PERSON_ONLY', sentence: 'Only a person approves a write.' };
      const s = steps.find((x) => x.id === stepId);
      if (!s) return { ok: false, code: 'PLAN_NOT_FOUND', sentence: `There is no step ${stepId}.` };
      s.approval = 'given';
      return view();
    },
    async runNext(_by, stepId) {
      const s = stepId ? steps.find((x) => x.id === stepId) : steps.find((x) => x.status === 'planned');
      if (!s || s.status !== 'planned') return { ok: false, code: 'PLAN_NOTHING', sentence: 'There is no step ready to run.' };
      if (s.approval === 'needed') return { ok: false, code: 'PLAN_NEEDS_APPROVAL', sentence: `Step ${s.n} writes, so it waits for a person to approve it.` };
      const apply = PLAN_OPS[s.tool] ? ops.applyChange(ROOT, ops[PLAN_OPS[s.tool]](ROOT, s.args)) : { ok: true, sentence: `Ran ${s.tool}.`, files: [], findings: [] };
      s.status = 'done'; s.result = { apply, sentence: apply.sentence };
      return view();
    },
  };
}

/** The registry over the mocks: `{registry, plan, ops}`. */
export function createMockToolRegistry() {
  const ops = createMockLineOps();
  const plan = createMockPlanService(ops);
  const registry = createToolRegistry({ root: ROOT, planService: plan, handlers: lineHandlers(ROOT, /** @type {any} */ ({ ...ops, readPageTree: () => ({ file: '', roots: [] }) })) });
  return { registry, plan, ops };
}
