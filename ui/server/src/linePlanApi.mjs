// cp1 (Line Cockpit): the plan routes of LINE_API (packages/engine/line/contract.mjs). Every Cockpit Line action is a
// step of the open project's plan session (packages/engine/line/planService.mjs, one session per project, kept in
// <root>/line/plans/): Cockpit adds the step, the person approves it, then it runs. Agents drive the same session
// over MCP (packages/mcp plan_* tools); only a person approves a write, so approval exists only here.
//
//   GET  /plan          the session's current plan (PlanView) plus `approvalToken` for the Cockpit page
//   POST /plan/step     {tool, args, why?}  add a step (a change is planned first; a refusal is a 400 sentence)
//   POST /plan/approve  {stepId} | {stepIds}  the person approves one step, or several with one click (Import)
//   POST /plan/run      {stepId?}           run the next approved step (exactly one)
//
// Only a person approves (review of cp1, 11 Oct): /plan/approve and /plan/run need the Cockpit page's Origin (a request
// with no Origin, as curl or an agent sends, is refused) and the header x-line-approval carrying this server's approval
// token, which only GET /plan hands out and which changes at every server start. Agents drive the same session over
// MCP (plan_status, plan_add_step, plan_run_next) and never see it. This keeps a local process from approving by
// accident or by a stray script; real enforcement against a hostile local process needs Cockpit auth
// (CONSTRUCT_GITHUB_* login), which stays off by default on loopback.
//
// A refusal is `{ok: false, sentence, code}`: 409 for a version conflict, 403 for a missing approval, 400 otherwise.
import crypto from 'node:crypto';
import express from 'express';
import { createLinePlanService } from '../../../packages/engine/line/planService.mjs';

const plain = (body) => (body && typeof body === 'object' && !Array.isArray(body) ? body : {});

/**
 * @param {{getRoot: () => ({ok: true, root: string} | {ok: false, error: string}), clientOrigin?: string,
 *   afterSave?: (root: string, relPath: string) => unknown, serviceFor?: (root: string) => any}} deps
 *   `serviceFor` defaults to one plan service per project root (tests pass their own, e.g. on the built-in store).
 * @returns {import('express').Router}
 */
export function createLinePlanRouter({ getRoot, clientOrigin, afterSave, serviceFor, approvalToken = crypto.randomBytes(24).toString('hex') }) {
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
  /** Approving and running are the person's: the Cockpit page's Origin and this server's approval token. */
  const personOnly = (req, res, next) => {
    const origin = req.get('origin');
    if (!origin || (clientOrigin && origin !== clientOrigin)) {
      return res.status(403).json({ ok: false, sentence: 'Only a person in Cockpit can approve or run a plan step; this request did not come from the Cockpit page.', code: 'NOT_COCKPIT' });
    }
    const given = String(req.get('x-line-approval') ?? '');
    const ok = given.length === approvalToken.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(approvalToken));
    if (!ok) return res.status(403).json({ ok: false, sentence: 'Only a person in Cockpit can approve or run a plan step; reload the page and try again.', code: 'NO_APPROVAL' });
    return next();
  };
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
  router.get('/plan', handle(async (svc) => { const v = await svc.view(); return v.ok ? { ...v, approvalToken } : v; }));
  router.post('/plan/step', handle((svc, body) => svc.addStep({ tool: body.tool, args: body.args, why: body.why }, 'ui')));
  router.post('/plan/approve', personOnly, handle(async (svc, body) => {
    if (!Array.isArray(body.stepIds)) return svc.approve(body.stepId, 'ui');
    if (!body.stepIds.length || body.stepIds.some((id) => typeof id !== 'string' || !id)) return { ok: false, code: 'BAD_ARGS', sentence: 'Name the steps to approve.' };
    let out = null;
    for (const id of body.stepIds) { out = await svc.approve(id, 'ui'); if (!out.ok) return out; }
    return out;
  }));
  router.post('/plan/run', personOnly, handle((svc, body) => svc.runNext('ui', typeof body.stepId === 'string' ? body.stepId : undefined)));
  return router;
}
