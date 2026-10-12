// "What Line knows" (packages/engine/line/knows/contract.mjs KNOWS_API): the page's routes under /api/line, each an
// entry of the one tool registry (the tool gate, lineToolGate.mjs, runs first and logs every memory write).
//
//   GET  /graph?focus=<node id>   GraphRead          GET /graph/changes  ChangeView      GET /graph/stats  SmartView
//   GET  /memory/records?step=    MemoryRecordsView  GET /memory/export  im3's MemoryExport
//   POST /memory/edit | /memory/forget-record | /memory/forget-all | /memory/import | /memory/embeddings
//        person only (Cockpit), Line's own state; im3's GET /memory and POST /memory/forget live in lineMemoryApi.mjs
//
// A proposed change is NOT written here: the page adds its plan step (line.setBase, line.promote, line.fix) through the
// plan routes, a person approves it, and Construct's writer lands it. Every failure is one sentence.
import express from 'express';
import { createKnowsService } from '../../../packages/engine/line/knows/service.mjs';

const plain = (body) => (body && typeof body === 'object' && !Array.isArray(body) ? body : {});
const FOCUS = /^(item:|unit:|feature:|route:|endpoint:|field:|table:|spec:|finding:|step:|library$)[^\n]{0,300}$/;

/**
 * @param {{getRoot: () => ({ok: true, root: string} | {ok: false, error: string}), clientOrigin?: string,
 *   serviceFor?: (root: string) => any}} deps `serviceFor` for tests (e.g. the engine's createMockKnows).
 * @returns {import('express').Router}
 */
export function createLineKnowsRouter({ getRoot, clientOrigin, serviceFor }) {
  const services = new Map();
  const forRoot = serviceFor ?? ((root) => { if (!services.has(root)) services.set(root, createKnowsService({ root })); return services.get(root); });
  const router = express.Router();
  const handle = (fn, failed) => async (req, res) => {
    const r = getRoot();
    if (!r.ok) return res.status(400).json({ ok: false, code: 'NO_PROJECT', sentence: r.error });
    if (req.method === 'POST') {
      const origin = req.get('origin');
      if (clientOrigin && origin && origin !== clientOrigin) return res.status(403).json({ ok: false, sentence: 'This request came from a page that is not the Cockpit.', code: 'FOREIGN_ORIGIN' });
      if (!req.is('application/json')) return res.status(415).json({ ok: false, sentence: 'Send it as JSON.', code: 'NOT_JSON' });
    }
    try {
      const out = await fn(forRoot(r.root), plain(req.body), req);
      if (out && out.ok === false) return res.status(400).json(out);
      return res.json(out);
    } catch (e) {
      const err = /** @type {any} */ (e);
      if (err?.name === 'LineOpError') return res.status(400).json({ ok: false, code: err.code, sentence: err.sentence });
      return res.status(500).json({ ok: false, code: 'READ_FAILED', sentence: failed });
    }
  };
  router.get('/graph', handle((s, _b, req) => {
    const focus = typeof req.query.focus === 'string' && req.query.focus ? req.query.focus : undefined;
    if (focus !== undefined && !FOCUS.test(focus)) return { ok: false, code: 'BAD_REQUEST', sentence: 'Name the item to start from, for example ?focus=item:orders/pages/OrdersPage.' };
    return s.graph(focus);
  }, 'Cockpit could not read what Line knows about this project.'));
  router.get('/graph/changes', handle((s) => s.changes(), 'Cockpit could not list the proposed changes.'));
  router.get('/graph/stats', handle((s) => s.stats(), 'Cockpit could not measure this project.'));
  // Memory's page routes (im3's GET /memory and POST /memory/forget stay in lineMemoryApi.mjs).
  router.get('/memory/records', handle((s, _b, req) => s.records({ ...(typeof req.query.step === 'string' && req.query.step ? { step: req.query.step } : {}) }), 'Cockpit could not read what Line remembered.'));
  router.get('/memory/export', handle((s) => s.exportMemory(), 'Cockpit could not export what Line remembered.'));
  router.post('/memory/edit', handle((s, b) => s.edit(b), 'Cockpit could not change that memory; nothing was changed.'));
  router.post('/memory/forget-record', handle((s, b) => s.forgetRecord(b), 'Cockpit could not forget that; nothing was changed.'));
  router.post('/memory/forget-all', handle((s) => s.forgetAll(), 'Cockpit could not forget that; nothing was changed.'));
  router.post('/memory/import', handle((s, b) => s.importMemory(b), 'Cockpit could not import that file; nothing was changed.'));
  router.post('/memory/embeddings', handle((s, b) => s.setEmbeddings(b), 'Cockpit could not change the embeddings switch; nothing was changed.'));
  return router;
}
