// #395/#771/#772 -- thin REST adapter over packages/core/flows.mjs (#759's save/load primitive): every named,
// reusable flow saved under the open project's `.construct/flows/` (#771's list), a deterministic envelope
// preview and a preview/commit save (this file, #772's "preview" and "save this flow" bullets). "Run this
// flow" wires into the existing Process/Approvals path instead (a later slice) -- nothing here executes
// anything.
import express from 'express';
import { listFlows, loadFlow, saveFlow, validateFlowSteps, flowToEnvelopeSteps } from '../../../packages/core/flows.mjs';
import { formatPlanErrors } from '../../../packages/core/plan.mjs';

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

/** @param {{getRoot: () => {ok:true, root:string} | {ok:false, error:string}}} deps */
export function createEnvelopesRouter({ getRoot }) {
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
  router.get('/:name', handle((root, req) => envelopeShow(root, req.params.name)));
  router.post('/:name', handle((root, req) => envelopeSave(root, req.params.name, req.body)));
  return router;
}
