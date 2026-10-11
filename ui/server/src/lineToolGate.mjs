// cu3 (Line Cockpit): every /api/line route resolves from the one tool registry (packages/engine/line/toolRegistry.mjs)
// before any other Line router sees it. Mounted first under /api/line (index.mjs):
//
//   GET  /tools        the registry (ToolList): each tool marked read or write, with its controlId when it has one
//   any other route    its registry entry (exactly one), else a 404 sentence: no Line route exists outside the registry
//     read                        -> next(): the route's own router answers it directly
//     write to Line's own state   -> next(), and the write is logged to line/log/tools.jsonl when it lands
//     write to project files      -> never written here: it becomes a plan step (waiting for the person's approval)
//                                    and answers ApplyResult-shaped {ok, sentence: "Waiting for your approval: ...",
//                                    files: [], findings: [], planned: {stepId}} so every caller sees nothing landed yet
import express from 'express';
import { entryForRoute, logToolWrite, toolView, allEntries } from '../../../packages/engine/line/toolRegistry.mjs';
import { createLinePlanService } from '../../../packages/engine/line/planService.mjs';

const plain = (body) => (body && typeof body === 'object' && !Array.isArray(body) ? body : {});

/**
 * @param {{getRoot: () => ({ok: true, root: string} | {ok: false, error: string}), clientOrigin?: string,
 *   planServiceFor?: (root: string) => any}} deps `planServiceFor` must be the SAME service the plan routes use.
 * @returns {import('express').Router}
 */
export function createLineToolGate({ getRoot, clientOrigin, planServiceFor }) {
  const services = new Map();
  const forRoot = planServiceFor ?? ((root) => { if (!services.has(root)) services.set(root, createLinePlanService({ root })); return services.get(root); });
  const router = express.Router();
  router.get('/tools', (_req, res) => res.json({ ok: true, tools: allEntries().map(toolView) }));
  router.use((req, res, next) => {
    const full = `/api/line${req.path.replace(/\/+$/, '') || ''}`;
    const entry = entryForRoute(req.method === 'HEAD' ? 'GET' : req.method, full);
    if (!entry) return res.status(404).json({ ok: false, code: 'UNKNOWN_ROUTE', sentence: `Line has no tool at ${req.method} ${full}.` });
    if (entry.kind === 'read') return next();
    const r = getRoot();
    if (!r.ok) return res.status(400).json({ ok: false, sentence: r.error, code: 'NO_PROJECT' });
    if (entry.writes === 'line') {
      res.on('finish', () => logToolWrite(r.root, { tool: entry.id, by: 'ui', ok: res.statusCode < 400 }));
      return next();
    }
    // A project write: only ever a plan step.
    const origin = req.get('origin');
    if (clientOrigin && origin && origin !== clientOrigin) return res.status(403).json({ ok: false, sentence: 'This request came from a page that is not the Cockpit.', code: 'FOREIGN_ORIGIN', files: [], findings: [] });
    if (!req.is('application/json')) return res.status(415).json({ ok: false, sentence: 'Send the change as JSON.', code: 'NOT_JSON', files: [], findings: [] });
    const args = plain(req.body);
    const parsed = entry.inputSchema.safeParse(args);
    if (!parsed.success) return res.status(400).json({ ok: false, code: 'BAD_ARGS', sentence: `The change is missing something: ${parsed.error.issues.map((i) => `${i.path.join('.') || 'args'} ${i.message}`).join('; ')}.`, files: [], findings: [] });
    Promise.resolve(forRoot(r.root).addStep({ tool: entry.id, args: parsed.data }, 'ui')).then((out) => {
      if (!out || out.ok === false) return res.status(out?.code === 'PLAN_CONFLICT' ? 409 : 400).json({ ok: false, sentence: out?.sentence ?? 'The plan refused this change; nothing was changed.', code: out?.code ?? 'REFUSED', ...(out?.detail ? { detail: out.detail } : {}), files: [], findings: [] });
      const step = out.steps.find((s) => s.id === out.stepId);
      return res.json({ ok: true, sentence: step?.sentence ?? `Waiting for your approval: ${entry.sentence}`, files: [], findings: [], planned: { stepId: out.stepId } });
    }, () => res.status(500).json({ ok: false, sentence: 'Cockpit could not add this change to the plan; nothing was changed.', code: 'INTERNAL', files: [], findings: [] }));
    return undefined;
  });
  return router;
}
