// #395/#771 -- thin REST adapter over packages/core/flows.mjs (#759's save/load primitive): every named,
// reusable flow saved under the open project's `.construct/flows/`, for the Envelopes tab's read-only list
// (this slice) and later the compose/save/run write paths (#772). No write path here yet.
import express from 'express';
import { listFlows, loadFlow } from '../../../packages/core/flows.mjs';

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
  router.get('/:name', handle((root, req) => envelopeShow(root, req.params.name)));
  return router;
}
