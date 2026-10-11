// System 1 drafter routes (LINE_API in packages/engine/line/contract.mjs), an optional first step of the plan
// (flag LINE_DRAFTER=1, default off). The drafter lists every route for a request, each tried by Construct on a copy of
// the project; picking one adds its steps to the same plan session as the Plan panel (planService.addStep), where a
// person approves each write. Nothing here writes project code.
//
//   GET  /plan/draft          {ok, on}                       whether the drafter is on
//   POST /plan/draft          {request}                      DraftView
//   POST /plan/draft/add      {request, routeId, from?}      the route's steps join the plan (PlanView & {added, next, sentence})
//   POST /plan/draft/answer   {word, key}                    "Did you mean ...?" answered; stored in the project's domain map
import express from 'express';
import { createPlanDrafter, drafterEnabled } from '@line/construct-engine/line/drafter/plan-draft';

const plain = (body) => (body && typeof body === 'object' && !Array.isArray(body) ? body : {});

/**
 * @param {{getRoot: () => ({ok: true, root: string} | {ok: false, error: string}), clientOrigin?: string,
 *   serviceFor: (root: string) => any, enabled?: boolean, draftFn?: (root: string, request: string) => any}} deps
 *   `serviceFor`: the plan service of a root (shared with linePlanApi.mjs so steps join the same session).
 * @returns {import('express').Router}
 */
export function createLineDraftRouter({ getRoot, clientOrigin, serviceFor, enabled = drafterEnabled(), draftFn }) {
  const drafters = new Map();
  const forRoot = (root) => {
    if (!drafters.has(root)) drafters.set(root, createPlanDrafter({ root, plan: serviceFor(root), enabled, ...(draftFn ? { draftFn } : {}) }));
    return drafters.get(root);
  };
  const router = express.Router();
  router.use('/plan/draft', (req, res, next) => {
    if (req.method === 'POST') {
      const origin = req.get('origin');
      if (clientOrigin && origin && origin !== clientOrigin) return res.status(403).json({ ok: false, sentence: 'This request came from a page that is not the Cockpit.', code: 'FOREIGN_ORIGIN' });
      if (!req.is('application/json')) return res.status(415).json({ ok: false, sentence: 'Send the request as JSON.', code: 'NOT_JSON' });
    }
    return next();
  });
  const handle = (fn) => async (req, res) => {
    const r = getRoot();
    if (!r.ok) return res.status(400).json({ ok: false, sentence: r.error, code: 'NO_PROJECT' });
    try {
      const out = await fn(forRoot(r.root), plain(req.body));
      if (out.ok === false) return res.status(out.code === 'DRAFTER_OFF' ? 404 : out.code === 'PLAN_CONFLICT' ? 409 : 400).json(out);
      return res.json(out);
    } catch {
      return res.status(500).json({ ok: false, sentence: 'Cockpit could not draft that; nothing was changed.', code: 'INTERNAL' });
    }
  };
  router.get('/plan/draft', (req, res) => res.json({ ok: true, on: enabled }));
  router.post('/plan/draft', handle((d, body) => d.draft(body.request)));
  router.post('/plan/draft/add', handle((d, body) => d.addRoute(body.request, body.routeId, 'ui', body.from)));
  router.post('/plan/draft/answer', handle((d, body) => d.answer(body.word, body.key)));
  return router;
}
