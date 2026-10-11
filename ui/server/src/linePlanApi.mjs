// cp1 (Line Cockpit): the plan routes of LINE_API (packages/engine/line/contract.mjs). Every Cockpit Line action is a
// step of the open project's plan session (packages/engine/line/planService.mjs, one session per project, kept in
// <root>/line/plans/): Cockpit adds the step, the person approves it, then it runs. Agents drive the same session
// over MCP (packages/mcp plan_* tools); only a person approves a write, so approval exists only here.
//
//   GET  /plan          the session's current plan (PlanView)
//   POST /plan/step     {tool, args, why?}  add a step (a change is planned first; a refusal is a 400 sentence)
//   POST /plan/approve  {stepId}            the person approves one step
//   POST /plan/run      {stepId?}           run the next approved step (exactly one)
//
// A refusal is `{ok: false, sentence, code}`: 409 for a version conflict, 400 otherwise.
import express from 'express';
import { createLinePlanService } from '../../../packages/engine/line/planService.mjs';

const plain = (body) => (body && typeof body === 'object' && !Array.isArray(body) ? body : {});

/**
 * @param {{getRoot: () => ({ok: true, root: string} | {ok: false, error: string}), clientOrigin?: string,
 *   afterSave?: (root: string, relPath: string) => unknown, serviceFor?: (root: string) => any}} deps
 *   `serviceFor` defaults to one plan service per project root (tests pass their own, e.g. on the built-in store).
 * @returns {import('express').Router}
 */
export function createLinePlanRouter({ getRoot, clientOrigin, afterSave, serviceFor }) {
  const services = new Map();
  const forRoot = serviceFor ?? ((root) => {
    if (!services.has(root)) services.set(root, createLinePlanService({ root, afterSave }));
    return services.get(root);
  });
  const router = express.Router();
  router.use('/plan', (req, res, next) => {
    if (req.method === 'POST') {
      const origin = req.get('origin');
      if (clientOrigin && origin && origin !== clientOrigin) return res.status(403).json({ ok: false, sentence: 'This request came from a page that is not the Cockpit.', code: 'FOREIGN_ORIGIN' });
      if (!req.is('application/json')) return res.status(415).json({ ok: false, sentence: 'Send the step as JSON.', code: 'NOT_JSON' });
    }
    return next();
  });
  const handle = (fn) => async (req, res) => {
    const r = getRoot();
    if (!r.ok) return res.status(400).json({ ok: false, sentence: r.error, code: 'NO_PROJECT' });
    try {
      const out = await fn(forRoot(r.root), plain(req.body));
      if (out.ok === false) return res.status(out.code === 'PLAN_CONFLICT' ? 409 : 400).json(out);
      return res.json(out);
    } catch {
      return res.status(500).json({ ok: false, sentence: 'Cockpit could not do that with the plan; nothing was changed.', code: 'INTERNAL' });
    }
  };
  router.get('/plan', handle((svc) => svc.view()));
  router.post('/plan/step', handle((svc, body) => svc.addStep({ tool: body.tool, args: body.args, why: body.why }, 'ui')));
  router.post('/plan/approve', handle((svc, body) => svc.approve(body.stepId, 'ui')));
  router.post('/plan/run', handle((svc, body) => svc.runNext('ui', typeof body.stepId === 'string' ? body.stepId : undefined)));
  return router;
}
