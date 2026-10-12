// im3 + j5 (Line): the open project's memory of past answers, per step, for Settings' "AI steps" panel and the
// "What Line knows" Memory tab (packages/engine/line/knows/contract.mjs KNOWS_API, knows/memory.mjs).
//   GET  /memory                 MemoryView: every memory step with its size (records live in <state>/memory/<step>.jsonl)
//   GET  /memory/records?step=   MemoryRecordsView: the records, the embeddings switch and the log
//   POST /memory/forget          {step}         forget one step's memory
//   POST /memory/edit            {id, chosen}   correct one record to another option Line offered
//   POST /memory/forget-record   {id}           forget one record
//   POST /memory/forget-all      {}             forget everything
//   GET  /memory/export          MemoryExport   the file the person keeps
//   POST /memory/import          MemoryExport   records already here are skipped; each passes the leak guard
//   POST /memory/embeddings      {on}           the per-project switch (slotted decision text only, never code)
// Every route but the two reads is a person's in Cockpit only: the page's Origin and the approval token GET
// /api/line/plan hands the page. Every change is logged (<state>/memory.log.jsonl). Nothing here reads another
// project's memory or sends a record anywhere.
import crypto from 'node:crypto';
import express from 'express';
import { memoryOf, MEMORY_STEPS, STEP_ID } from '@line/construct-engine/line/memory';
import { createMemoryService } from '../../../packages/engine/line/knows/memory.mjs';

const plain = (body) => (body && typeof body === 'object' && !Array.isArray(body) ? body : {});
const count = (n) => `${n} remembered decision${n === 1 ? '' : 's'}`;

/**
 * @param {{getRoot: () => ({ok: true, root: string} | {ok: false, error: string}), clientOrigin?: string, approvalToken: string,
 *   memoryFor?: (root: string) => any, serviceFor?: (root: string) => any}} deps `approvalToken`: the plan router's token
 *   (a person's Cockpit page holds it); `serviceFor`: the Memory tab's service (default knows/memory.mjs on `memoryFor`).
 * @returns {import('express').Router}
 */
export function createLineMemoryRouter({ getRoot, clientOrigin, approvalToken, memoryFor = memoryOf, serviceFor }) {
  const router = express.Router();
  const services = new Map();
  const service = serviceFor ?? ((root) => { if (!services.has(root)) services.set(root, createMemoryService(root, { memory: memoryFor(root) })); return services.get(root); });
  const view = (root) => {
    const sizes = memoryFor(root).sizes();
    const steps = [...new Set([...Object.keys(MEMORY_STEPS), ...Object.keys(sizes)])].map((step) => ({ step, label: MEMORY_STEPS[/** @type {keyof typeof MEMORY_STEPS} */ (step)] ?? step, size: sizes[step] ?? 0 }));
    const total = steps.reduce((s, x) => s + x.size, 0);
    return { ok: true, steps, total, sentence: total ? `Line remembers ${count(total)} for this project, on this computer only.` : 'Line has no memory for this project yet; it learns from what you pick, approve and change.' };
  };

  /**
   * A person in Cockpit: the page's Origin and the approval token. Sends the refusal and answers true, else false.
   * @param {import('express').Request} req @param {import('express').Response} res @param {string} what
   */
  const notPerson = (req, res, what) => {
    const origin = req.get('origin');
    if (!origin || (clientOrigin && origin !== clientOrigin)) {
      res.status(403).json({ ok: false, sentence: `Only a person in Cockpit can ${what}; this request did not come from the Cockpit page.`, code: 'NOT_COCKPIT' });
      return true;
    }
    const given = String(req.get('x-line-approval') ?? '');
    if (given.length !== approvalToken.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(approvalToken))) {
      res.status(403).json({ ok: false, sentence: `Only a person in Cockpit can ${what}; reload the page and try again.`, code: 'NO_APPROVAL' });
      return true;
    }
    if (req.method === 'POST' && !req.is('application/json')) {
      res.status(415).json({ ok: false, sentence: 'Send the request as JSON.', code: 'NOT_JSON' });
      return true;
    }
    return false;
  };

  /**
   * One Memory tab route: the person check (writes and export), the open project, then the service's answer.
   * @param {string} what @param {boolean} person @param {(s: any, body: Record<string, unknown>, req: import('express').Request) => unknown} fn @param {string} failed
   */
  const route = (what, person, fn, failed) => async (/** @type {import('express').Request} */ req, /** @type {import('express').Response} */ res) => {
    if (person && notPerson(req, res, what)) return undefined;
    const r = getRoot();
    if (!r.ok) return res.status(400).json({ ok: false, sentence: r.error, code: 'NO_PROJECT' });
    try {
      const out = /** @type {any} */ (await fn(service(r.root), plain(req.body), req));
      if (out && out.ok === false) return res.status(400).json(out);
      return res.json(out);
    } catch (e) {
      const err = /** @type {any} */ (e);
      if (err?.name === 'LineOpError') return res.status(400).json({ ok: false, code: err.code, sentence: err.sentence });
      return res.status(500).json({ ok: false, code: 'INTERNAL', sentence: failed });
    }
  };

  router.get('/memory', (req, res) => {
    const r = getRoot();
    if (!r.ok) return res.json({ ok: true, steps: [], total: 0, sentence: 'No project is open, so there is no memory to show.' });
    try { return res.json(view(r.root)); } catch {
      return res.status(500).json({ ok: false, sentence: 'Cockpit could not read this project\'s memory; Line ranks by its static order meanwhile.', code: 'INTERNAL' });
    }
  });
  router.post('/memory/forget', (req, res) => {
    if (notPerson(req, res, 'forget a step\'s memory')) return undefined;
    const r = getRoot();
    if (!r.ok) return res.status(400).json({ ok: false, sentence: r.error, code: 'NO_PROJECT' });
    const step = plain(req.body).step;
    if (typeof step !== 'string' || !STEP_ID.test(step)) return res.status(400).json({ ok: false, sentence: 'Name the step whose memory to forget.', code: 'BAD_ARGS' });
    try {
      const out = service(r.root).forgetStep({ step });
      return res.json({ ...view(r.root), message: out.removed ? `Line forgot ${count(out.removed)} for this step.` : 'There was nothing to forget for this step.' });
    } catch {
      return res.status(500).json({ ok: false, sentence: 'Cockpit could not forget that; nothing was changed.', code: 'INTERNAL' });
    }
  });

  // "What Line knows", Memory tab.
  router.get('/memory/records', route('read memory', false, (s, _b, req) => s.records({ step: typeof req.query.step === 'string' ? req.query.step : undefined }), 'Cockpit could not read what Line remembered.'));
  router.get('/memory/export', route('export Line\'s memory', true, (s) => s.exportMemory(), 'Cockpit could not export what Line remembered.'));
  router.post('/memory/edit', route('change what Line remembered', true, (s, b) => s.edit(b), 'Cockpit could not change that memory; nothing was changed.'));
  router.post('/memory/forget-record', route('make Line forget a decision', true, (s, b) => s.forgetRecord(b), 'Cockpit could not forget that; nothing was changed.'));
  router.post('/memory/forget-all', route('make Line forget everything', true, (s) => s.forgetAll(), 'Cockpit could not forget that; nothing was changed.'));
  router.post('/memory/import', route('import a memory file', true, (s, b) => s.importMemory(b), 'Cockpit could not import that file; nothing was changed.'));
  router.post('/memory/embeddings', route('turn embeddings on or off', true, (s, b) => s.setEmbeddings(b), 'Cockpit could not change the embeddings switch; nothing was changed.'));
  return router;
}
