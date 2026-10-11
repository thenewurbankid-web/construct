// The Line Cockpit API (packages/engine/line/contract.mjs LINE_API), mounted at /api/line below the session
// gate (index.mjs). This part serves the read-only project view only: GET /api/line/project answers the
// contract's LineProject for the open project (readLineProject, packages/engine/line/model.mjs). The write
// routes (base-on, promote, page-prop) are added beside it and go through applyChange (the writer) only.
// Errors are one plain-English sentence: a LineOpError becomes 400 {ok:false, sentence, code}.
import express from 'express';
import { LineOpError } from '../../../packages/engine/line/contract.mjs';
import { readLineProject } from '../../../packages/engine/line/model.mjs';

/**
 * @param {{getRoot: () => ({ok: true, root: string} | {ok: false, error: string}),
 *   readProject?: (root: string) => import('../../../packages/engine/line/contract.mjs').LineProject}} deps
 *   `readProject` defaults to the real model; tests pass the contract's mock.
 * @returns {import('express').Router}
 */
export function createLineRouter({ getRoot, readProject = readLineProject }) {
  const router = express.Router();
  router.get('/project', (req, res) => {
    const r = getRoot();
    if (!r.ok) return res.status(400).json({ ok: false, code: 'NO_PROJECT', sentence: r.error });
    try {
      return res.json(readProject(r.root));
    } catch (e) {
      if (e instanceof LineOpError) return res.status(400).json({ ok: false, code: e.code, sentence: e.sentence });
      return res.status(500).json({ ok: false, code: 'READ_FAILED', sentence: 'Cockpit could not read this project as a Line project.' });
    }
  });
  return router;
}
