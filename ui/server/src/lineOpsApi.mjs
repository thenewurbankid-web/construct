// T4 of the Line Cockpit (packages/engine/line/contract.mjs, LINE_API): the /api/line routes that read a page's
// parts and the one folder Line may change. A change to the project is never a route of its own: it is a step of the
// project's plan (linePlanApi.mjs: line.setPageProp, line.baseOn, line.promote, line.fix, line.setFragment), which a
// person approves and which lands only through applyChange. GET /api/line/project lives in lineApi.mjs.
//
//   GET  /page-tree?file=   readPageTree   (packages/engine/line/pageProp.mjs)
//   GET  /workspace         readWorkspace  (packages/engine/line/workspace.mjs; cu6)
//   POST /workspace         setWorkspace   -> line/workspace.json through Construct's writer (Line's own setting,
//                                             not a project change, so it stays a direct route)
//   GET  /fragments?file=   listFragments  (packages/engine/line/fragments.mjs, cx1)
//   GET  /page-binding?file= readPageBinding (packages/engine/line/pageBinding.mjs, cu5): both bindings of one page
//
// A LineOpError is a 400 `{ok: false, sentence, code, detail?}`; anything unexpected is a 500 with one sentence.
import express from 'express';
import { LineOpError } from '../../../packages/engine/line/contract.mjs';
import { readPageTree } from '../../../packages/engine/line/pageProp.mjs';
import { readWorkspace, setWorkspace } from '../../../packages/engine/line/workspace.mjs';
import { listFragments } from '../../../packages/engine/line/fragments.mjs';
import { readPageBinding } from '../../../packages/engine/line/pageBinding.mjs';

/** The real operations; tests may pass their own (for example the contract's mock). */
export const REAL_LINE_OPS = Object.freeze({ readPageTree, listFragments, readWorkspace, setWorkspace, readPageBinding });

const plain = (body) => (body && typeof body === 'object' && !Array.isArray(body) ? body : {});

/**
 * @param {{getRoot: () => ({ok: true, root: string} | {ok: false, error: string}), clientOrigin?: string,
 *   afterSave?: (root: string, relPath: string) => unknown, ops?: typeof REAL_LINE_OPS}} deps  `afterSave` is unused since the writes moved to the plan (kept so callers need no change)
 * @returns {import('express').Router}
 */
export function createLineOpsRouter({ getRoot, clientOrigin, ops = REAL_LINE_OPS }) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (req.method === 'POST') {
      const origin = req.get('origin');
      if (clientOrigin && origin && origin !== clientOrigin) return res.status(403).json({ ok: false, sentence: 'This request came from a page that is not the Cockpit.', code: 'FOREIGN_ORIGIN' });
      if (!req.is('application/json')) return res.status(415).json({ ok: false, sentence: 'Send the change as JSON.', code: 'NOT_JSON' });
    }
    return next();
  });
  const handle = (fn) => async (req, res) => {
    const r = getRoot();
    if (!r.ok) return res.status(400).json({ ok: false, sentence: r.error, code: 'NO_PROJECT' });
    try {
      return res.json(await fn(r.root, req));
    } catch (e) {
      if (e instanceof LineOpError || /** @type {any} */ (e)?.name === 'LineOpError') {
        const { sentence, code, detail } = /** @type {any} */ (e);
        return res.status(400).json({ ok: false, sentence, code, ...(typeof detail === 'string' ? { detail } : {}) });
      }
      return res.status(500).json({ ok: false, sentence: 'Cockpit could not do that; nothing was changed.', code: 'INTERNAL' });
    }
  };
  router.get('/page-tree', handle((root, req) => ops.readPageTree(root, typeof req.query.file === 'string' ? req.query.file : '')));
  // cu6: the one folder Line may change; everything outside it stays read-only (applyChange refuses it).
  router.get('/workspace', handle((root) => ops.readWorkspace(root)));
  router.post('/workspace', handle((root, req) => ops.setWorkspace(root, /** @type {any} */ (plain(req.body)))));
  router.get('/fragments', handle((root, req) => ops.listFragments(root, typeof req.query.file === 'string' ? req.query.file : '')));
  // cu5: Morpheus's and Trace's bindings of one page; binding a part or an action is a plan step (line.bindPart, line.bindInteraction).
  router.get('/page-binding', handle((root, req) => ops.readPageBinding(root, typeof req.query.file === 'string' ? req.query.file : '')));
  return router;
}
