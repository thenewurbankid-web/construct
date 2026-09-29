// #395/#771/#772 -- thin REST adapter over packages/core/flows.mjs (#759's save/load primitive): every named,
// reusable flow saved under the open project's `.construct/flows/` (#771's list), a deterministic envelope
// preview, a preview/commit save, and "Run this flow" (#772) through the exact validate-then-start pipeline
// planService.run() uses -- a saved/composed flow's steps are already plan steps (flows.mjs is built on
// plan.mjs's createPlan/validatePlan), so this wraps them in a synthetic plan and calls the same
// checkPlan/startPlan, never a second execution mechanism.
import express from 'express';
import { listFlows, loadFlow, saveFlow, validateFlowSteps, flowToEnvelopeSteps } from '../../../packages/core/flows.mjs';
import { formatPlanErrors, PLAN_VERSION } from '../../../packages/core/plan.mjs';
import { checkPlan } from './planService.mjs';

/** @returns {{status:number, body:object}} */
export function envelopesIndex(root) {
  const flows = listFlows(root).map((name) => {
    const loaded = loadFlow(root, name);
    if (!loaded.ok) return { name, stepCount: 0, steps: [], error: loaded.errors.join(' ') };
    return { name, stepCount: loaded.steps.length, steps: loaded.steps, error: null };
  });
  return { status: 200, body: { ok: true, flows } };
}

/** @returns {{status:number, body:object}} */
export function envelopeShow(root, name) {
  const loaded = loadFlow(root, name);
  if (!loaded.ok) return { status: 404, body: { ok: false, error: loaded.errors.join(' ') } };
  return { status: 200, body: { ok: true, name, steps: loaded.steps, savedAt: loaded.savedAt ?? null } };
}

/** #772 -- the envelope each step of a composed flow would receive, computed deterministically (no
 * generator runs, nothing written): `steps[i].envelope` is what `construct pipeline run` would be handed if
 * started at step `i`, in `schemas/envelope.v1.json`'s input shape (`layers` empty -- nothing has committed
 * yet from this preview's point of view; `steps` is the remaining generation work `flowToEnvelopeSteps`
 * derives from `create.unit` steps onward, in order).
 * @returns {{status:number, body:object}} */
export function envelopePreview(steps) {
  if (!Array.isArray(steps)) return { status: 400, body: { ok: false, error: 'steps must be an array.' } };
  const feature = steps.map((s) => s?.args?.feature).find((f) => typeof f === 'string' && f) ?? null;
  const previews = steps.map((_, i) => ({
    version: 1,
    feature,
    status: 'pending',
    layers: {},
    steps: flowToEnvelopeSteps(steps.slice(i)),
  }));
  return { status: 200, body: { ok: true, previews } };
}

/** #772 -- "Save this flow": preview/commit, same shape as rulesApi.mjs's writers (nothing written until
 * `commit: true`). Preview validates without writing; commit calls #759's saveFlow, which never writes an
 * invalid flow.
 * @returns {{status:number, body:object}} */
export function envelopeSave(root, name, body) {
  const { steps, commit } = body ?? {};
  if (typeof name !== 'string' || !name.trim()) return { status: 400, body: { ok: false, error: 'A flow name is required.' } };
  if (!Array.isArray(steps) || steps.length === 0) return { status: 400, body: { ok: false, error: 'At least one step is required.' } };

  if (commit !== true) {
    const { valid, errors } = validateFlowSteps(steps);
    if (!valid) return { status: 422, body: { ok: false, error: 'That flow would be invalid.', errors: formatPlanErrors(errors) } };
    return { status: 200, body: { ok: true, name, steps, changed: true } };
  }
  const result = saveFlow(root, name, steps);
  if (!result.ok) return { status: 422, body: { ok: false, error: result.errors.join(' '), errors: result.errors } };
  return { status: 200, body: { ok: true, name } };
}

function blockSettingsFor(getBlockSettings, root) {
  if (!getBlockSettings) return {};
  try {
    const s = getBlockSettings(root);
    return { disabledFlows: Array.isArray(s?.flows) ? s.flows : [] };
  } catch {
    return {};
  }
}

/** #772 -- "Run this flow": the exact same re-validate-then-start pipeline planService.run() uses
 * (checkPlan, then `startPlan`, the process-engine dependency `createProcessesService` and the Processes
 * drawer share). The flow's steps become a synthetic plan's steps; nothing here creates a second way to run
 * a step.
 * @returns {{status:number, body:object}} */
export function envelopeRun(root, body, { startPlan, getBlockSettings }) {
  const { steps, name } = body ?? {};
  if (!Array.isArray(steps) || steps.length === 0) return { status: 400, body: { ok: false, error: 'At least one step is required.' } };

  const plan = { version: PLAN_VERSION, ticket: { source: 'text', title: typeof name === 'string' && name.trim() ? name.trim() : 'Envelope flow' }, steps };
  const checked = checkPlan(plan, root, blockSettingsFor(getBlockSettings, root));
  if (!checked.valid) return { status: 400, body: { ok: false, error: 'This flow is not valid, so it was not run.', errors: checked.errors } };

  const started = startPlan(plan);
  if (!started?.ok) return { status: started?.status || 500, body: { ok: false, error: started?.error || 'The flow could not be started.' } };
  return { status: 200, body: { ok: true, processId: started.processId, models: steps.filter((s) => s.executor === 'local-model').map((s) => s.id) } };
}

/** @param {{getRoot: () => {ok:true, root:string} | {ok:false, error:string}, startPlan?: (plan:object) => {ok:boolean, processId?:string, status?:number, error?:string}, getBlockSettings?: (root:string) => unknown}} deps */
export function createEnvelopesRouter({ getRoot, startPlan, getBlockSettings }) {
  const router = express.Router();
  const handle = (fn) => (req, res) => {
    const r = getRoot();
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    try {
      const out = fn(r.root, req);
      return res.status(out.status).json(out.body);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message || 'Could not process that envelopes request.' });
    }
  };
  router.get('/', handle((root) => envelopesIndex(root)));
  router.post('/preview', handle((_root, req) => envelopePreview(req.body?.steps)));
  router.post('/run', handle((root, req) => {
    if (!startPlan) return { status: 501, body: { ok: false, error: 'Running a flow is not wired up on this server.' } };
    return envelopeRun(root, req.body, { startPlan, getBlockSettings });
  }));
  router.get('/:name', handle((root, req) => envelopeShow(root, req.params.name)));
  router.post('/:name', handle((root, req) => envelopeSave(root, req.params.name, req.body)));
  return router;
}
