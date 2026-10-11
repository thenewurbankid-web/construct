// T4 of the Line Cockpit (packages/engine/line/contract.mjs, LINE_API): the /api/line routes that read a page's
// parts and change the project. Every change is planned by a pure engine function and written only by
// applyChange (packages/engine/line/ops.mjs), i.e. through Construct's transactional writer with the project's
// own validate profile as the gate. GET /api/line/project lives in the model router (lineApi.mjs).
//
//   GET  /page-tree?file=   readPageTree   (packages/engine/line/pageProp.mjs)
//   POST /page-prop         planSetProp    -> applyChange
//   POST /base-on           planBaseOn     -> applyChange
//   POST /promote           planPromote    -> applyChange
//   POST /fix               applyFix       (fixes.mjs: the finding by key, its typed fix planned -> applyChange)
//
// A LineOpError is a 400 `{ok: false, sentence, code}`; anything unexpected is a 500 with one sentence.
import express from 'express';
import { LineOpError } from '../../../packages/engine/line/contract.mjs';
import { planBaseOn, planPromote, applyChange } from '../../../packages/engine/line/ops.mjs';
import { planSetProp, readPageTree } from '../../../packages/engine/line/pageProp.mjs';
import { applyFix } from '../../../packages/engine/line/fixes.mjs';

/** The real operations; tests may pass their own (for example the contract's mock). */
export const REAL_LINE_OPS = Object.freeze({ readPageTree, planSetProp, planBaseOn, planPromote, applyChange, applyFix });

const plain = (body) => (body && typeof body === 'object' && !Array.isArray(body) ? body : {});

/**
 * @param {{getRoot: () => ({ok: true, root: string} | {ok: false, error: string}), clientOrigin?: string,
 *   afterSave?: (root: string, relPath: string) => unknown, ops?: typeof REAL_LINE_OPS}} deps
 * @returns {import('express').Router}
 */
export function createLineOpsRouter({ getRoot, clientOrigin, afterSave, ops = REAL_LINE_OPS }) {
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
        return res.status(400).json({ ok: false, sentence: /** @type {any} */ (e).sentence, code: /** @type {any} */ (e).code });
      }
      return res.status(500).json({ ok: false, sentence: 'Cockpit could not do that; nothing was changed.', code: 'INTERNAL' });
    }
  };
  /** Plan, then apply through the writer; after a landed change, run the usual after-save hook per file. */
  const change = (plan) => handle((root, req) => {
    const result = ops.applyChange(root, plan(root, plain(req.body)));
    if (result.ok && afterSave) for (const f of result.files) afterSave(root, f);
    return result;
  });
  router.get('/page-tree', handle((root, req) => ops.readPageTree(root, typeof req.query.file === 'string' ? req.query.file : '')));
  router.post('/page-prop', change((root, body) => ops.planSetProp(root, body)));
  router.post('/base-on', change((root, body) => ops.planBaseOn(root, body)));
  router.post('/promote', change((root, body) => ops.planPromote(root, body)));
  router.post('/fix', handle((root, req) => {
    const result = ops.applyFix(root, /** @type {any} */ (plain(req.body)));
    if (result.ok && afterSave) for (const f of result.files) afterSave(root, f);
    return result;
  }));
  return router;
}
