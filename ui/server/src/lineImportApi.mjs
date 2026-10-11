// ci1 (Line Import, partial migration; packages/engine/line/contract.mjs LINE_API): bring one folder of the open project
// into Line. The open project is the source and is only read; every write is a plan step landed by applyChange with the
// folder as the writer's root, so nothing outside the folder can be written (import.mjs applyImport).
//
//   GET  /import/folders   listImportFolders   the project's folders that hold code
//   POST /import/scan      scanImport          {folder} -> ImportScan (pure read, no model)
//   POST /import/plan      planImport          {folder, answers} -> ImportPlan (plan-ready steps, nothing written)
//   POST /import/apply     applyImport         {folder, answers} -> ImportApplyResult (the plan is recomputed here, never
//                                              taken from the client, so the client cannot send its own steps)
//
// A LineOpError is a 400 `{ok: false, sentence, code}`; anything unexpected is a 500 with one sentence.
import express from 'express';
import { LineOpError } from '../../../packages/engine/line/contract.mjs';
import { listImportFolders, scanImport, planImport, applyImport } from '../../../packages/engine/line/import.mjs';

/** The real import operations; tests may pass the contract's mock (mockImport.mjs createMockImport) instead. */
export const REAL_IMPORT_OPS = Object.freeze({
  folders: (root) => listImportFolders(root),
  scan: (root, { folder }) => scanImport(root, folder),
  plan: (root, { folder, answers }) => planImport(root, folder, answers),
  apply: (root, { folder, answers }) => applyImport(root, folder, answers),
});

const plain = (body) => (body && typeof body === 'object' && !Array.isArray(body) ? body : {});
const answersOf = (a) => Object.fromEntries(Object.entries(plain(a)).filter(([k, v]) => typeof k === 'string' && typeof v === 'string'));

/**
 * @param {{getRoot: () => ({ok: true, root: string} | {ok: false, error: string}), clientOrigin?: string,
 *   afterSave?: (root: string, relPath: string) => unknown, ops?: typeof REAL_IMPORT_OPS}} deps
 * @returns {import('express').Router}
 */
export function createLineImportRouter({ getRoot, clientOrigin, afterSave, ops = REAL_IMPORT_OPS }) {
  const router = express.Router();
  router.use('/import', (req, res, next) => {
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
      return res.json(await fn(r.root, plain(req.body)));
    } catch (e) {
      if (e instanceof LineOpError || /** @type {any} */ (e)?.name === 'LineOpError') {
        return res.status(400).json({ ok: false, sentence: /** @type {any} */ (e).sentence, code: /** @type {any} */ (e).code });
      }
      return res.status(500).json({ ok: false, sentence: 'Cockpit could not do that; nothing was changed.', code: 'INTERNAL' });
    }
  };
  const folderOf = (body) => (typeof body.folder === 'string' ? body.folder : '');
  router.get('/import/folders', handle((root) => ops.folders(root)));
  router.post('/import/scan', handle((root, body) => ops.scan(root, { folder: folderOf(body) })));
  router.post('/import/plan', handle((root, body) => ops.plan(root, { folder: folderOf(body), answers: answersOf(body.answers) })));
  router.post('/import/apply', handle((root, body) => {
    const result = ops.apply(root, { folder: folderOf(body), answers: answersOf(body.answers) });
    if (afterSave) for (const f of [...(result.files ?? []), ...(result.landed ?? [])]) afterSave(root, f);
    return result;
  }));
  return router;
}
