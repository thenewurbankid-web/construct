// cg1 (Line Cockpit): POST /api/line/trace -- Trace mode's question "which controls do this?" (LINE_API,
// packages/engine/line/contract.mjs TraceMatch). The request's words and the plan's open steps map to tools and then to
// controls (packages/engine/line/trace.mjs, static first); when several tools fit, jev picks with a cloze through
// @mx/reason, else the static order stands (traceDecide.mjs), and `via` records which. A pure read: nothing is planned
// or written here; a change still happens only as a plan step the person approves.
import express from 'express';
import { readLineProject } from '../../../packages/engine/line/model.mjs';
import { traceMatch } from '../../../packages/engine/line/trace.mjs';
import { createTraceDecide } from '../../../packages/engine/line/traceDecide.mjs';

const plain = (body) => (body && typeof body === 'object' && !Array.isArray(body) ? body : {});

/**
 * @param {{getRoot: () => ({ok: true, root: string} | {ok: false, error: string}), clientOrigin?: string,
 *   decide?: (options: string[], request: string) => Promise<{picked: string, via: 'static'|'jev', note: string}>,
 *   readProject?: (root: string) => any}} deps  `decide` defaults to jev through @mx/reason with the static fallback.
 * @returns {import('express').Router}
 */
export function createLineTraceRouter({ getRoot, clientOrigin, decide = createTraceDecide(), readProject = readLineProject }) {
  const router = express.Router();
  router.post('/trace', async (req, res) => {
    const origin = req.get('origin');
    if (clientOrigin && origin && origin !== clientOrigin) return res.status(403).json({ ok: false, sentence: 'This request came from a page that is not the Cockpit.', code: 'FOREIGN_ORIGIN' });
    if (!req.is('application/json')) return res.status(415).json({ ok: false, sentence: 'Send the request as JSON.', code: 'NOT_JSON' });
    const body = plain(req.body);
    if (body.request !== undefined && typeof body.request !== 'string') return res.status(400).json({ ok: false, sentence: 'The request must be text.', code: 'BAD_ARGS' });
    if (body.steps !== undefined && !Array.isArray(body.steps)) return res.status(400).json({ ok: false, sentence: 'The steps must be a list.', code: 'BAD_ARGS' });
    const r = getRoot();
    let project = null;
    if (r.ok) { try { project = readProject(r.root); } catch { project = null; } }
    try {
      return res.json(await traceMatch({ request: body.request, steps: body.steps }, { project, decide }));
    } catch {
      return res.status(500).json({ ok: false, sentence: 'Trace could not read that request; nothing was changed.', code: 'INTERNAL' });
    }
  });
  return router;
}
