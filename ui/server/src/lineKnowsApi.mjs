// "What Line knows" (packages/engine/line/knows/contract.mjs KNOWS_API): the page's routes under /api/line, each an
// entry of the one tool registry (the tool gate, lineToolGate.mjs, runs first and logs every memory write).
//
//   GET  /graph?focus=<node id>   GraphRead          GET /graph/changes  ChangeView      GET /graph/stats  SmartView
//   The Memory tab's routes (/memory/records, export, edit, forget-record, forget-all, import, embeddings) live in
//   lineMemoryApi.mjs beside im3's GET /memory and POST /memory/forget: person only (Cockpit), logged.
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
  // Memory's page routes live with im3's GET /memory and POST /memory/forget in lineMemoryApi.mjs, behind the same
  // person check (the Cockpit's Origin plus the approval token).
  return router;
}
