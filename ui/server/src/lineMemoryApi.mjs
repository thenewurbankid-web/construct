// im3 + j5 (Line): the open project's memory of past answers, per step, for Settings' "AI steps" panel.
//   GET  /memory          MemoryView: every memory step with its size (records live in <state>/memory/<step>.jsonl)
//   POST /memory/forget   {step}  forget one step's memory (one click, a person in Cockpit only: the page's Origin and
//                                 the approval token GET /api/line/plan hands the page)
// Nothing here reads another project's memory or sends a record anywhere.
import crypto from 'node:crypto';
import express from 'express';
import { memoryOf, MEMORY_STEPS, STEP_ID } from '@line/construct-engine/line/memory';

const plain = (body) => (body && typeof body === 'object' && !Array.isArray(body) ? body : {});
const count = (n) => `${n} remembered decision${n === 1 ? '' : 's'}`;

/**
 * @param {{getRoot: () => ({ok: true, root: string} | {ok: false, error: string}), clientOrigin?: string, approvalToken: string,
 *   memoryFor?: (root: string) => any}} deps `approvalToken`: the plan router's token (a person's Cockpit page holds it).
 * @returns {import('express').Router}
 */
export function createLineMemoryRouter({ getRoot, clientOrigin, approvalToken, memoryFor = memoryOf }) {
  const router = express.Router();
  const view = (root) => {
    const sizes = memoryFor(root).sizes();
    const steps = [...new Set([...Object.keys(MEMORY_STEPS), ...Object.keys(sizes)])].map((step) => ({ step, label: MEMORY_STEPS[/** @type {keyof typeof MEMORY_STEPS} */ (step)] ?? step, size: sizes[step] ?? 0 }));
    const total = steps.reduce((s, x) => s + x.size, 0);
    return { ok: true, steps, total, sentence: total ? `Line remembers ${count(total)} for this project, on this computer only.` : 'Line has no memory for this project yet; it learns from what you pick, approve and change.' };
  };
  router.get('/memory', (req, res) => {
    const r = getRoot();
    if (!r.ok) return res.json({ ok: true, steps: [], total: 0, sentence: 'No project is open, so there is no memory to show.' });
    try { return res.json(view(r.root)); } catch {
      return res.status(500).json({ ok: false, sentence: 'Cockpit could not read this project\'s memory; Line ranks by its static order meanwhile.', code: 'INTERNAL' });
    }
  });
  router.post('/memory/forget', (req, res) => {
    const origin = req.get('origin');
    if (!origin || (clientOrigin && origin !== clientOrigin)) return res.status(403).json({ ok: false, sentence: 'Only a person in Cockpit can forget a step\'s memory; this request did not come from the Cockpit page.', code: 'NOT_COCKPIT' });
    const given = String(req.get('x-line-approval') ?? '');
    if (given.length !== approvalToken.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(approvalToken))) {
      return res.status(403).json({ ok: false, sentence: 'Only a person in Cockpit can forget a step\'s memory; reload the page and try again.', code: 'NO_APPROVAL' });
    }
    if (!req.is('application/json')) return res.status(415).json({ ok: false, sentence: 'Send the request as JSON.', code: 'NOT_JSON' });
    const r = getRoot();
    if (!r.ok) return res.status(400).json({ ok: false, sentence: r.error, code: 'NO_PROJECT' });
    const step = plain(req.body).step;
    if (typeof step !== 'string' || !STEP_ID.test(step)) return res.status(400).json({ ok: false, sentence: 'Name the step whose memory to forget.', code: 'BAD_ARGS' });
    try {
      const out = memoryFor(r.root).forget(step);
      return res.json({ ...view(r.root), message: out.removed ? `Line forgot ${count(out.removed)} for this step.` : 'There was nothing to forget for this step.' });
    } catch {
      return res.status(500).json({ ok: false, sentence: 'Cockpit could not forget that; nothing was changed.', code: 'INTERNAL' });
    }
  });
  return router;
}
