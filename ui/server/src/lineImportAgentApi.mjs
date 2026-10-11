// ci2 (Line Import agent; packages/engine/line/contract.mjs LINE_API): the Import agent's routes. The agent is a fixed
// process (packages/engine/line/importAgent.mjs) whose state is <folder>/line/import-plan.json; it executes only by adding
// steps to the project's cp1 plan session, so it shares the plan service with linePlanApi.mjs (`planServiceFor`), and a
// person approves every write there (or in the review). The person drives it here as "ui"; agents drive it over MCP.
//
//   GET  /import-agent?folder=   the process as it stands
//   POST /import-agent/start     {folder, route?}                 scan, map (folder or route), characterize, classify, plan;
//                                                                 stops at the review
//   POST /import-agent/resume    {folder}                         carry on until it needs someone
//   POST /import-agent/pause     {folder}
//   POST /import-agent/step      {folder, stepId?, action, args?, to?}   edit, skip, unskip, move, approve, approve-all
//   POST /import-agent/answer    {folder, questionId, optionId}   answer the one open question
//
// A refusal is a 400 `{ok: false, sentence, code}`; anything unexpected is a 500 with one sentence.
import express from 'express';
import { createImportAgentOnDisk } from '../../../packages/engine/line/importAgentDisk.mjs';
import { folderProblem, folderRootOf } from '../../../packages/engine/line/importTools.mjs';
import { verifyImport, lineBaseline } from '../../../packages/engine/line/importVerify.mjs';
import { createReasonProvider } from '../../../packages/core/reason-provider.mjs';

const plain = (body) => (body && typeof body === 'object' && !Array.isArray(body) ? body : {});

/**
 * @param {{getRoot: () => ({ok: true, root: string} | {ok: false, error: string}), clientOrigin?: string,
 *   planServiceFor: (root: string) => any, agentFor?: (root: string, folder: string) => any}} deps
 *   `agentFor` defaults to one real agent per (root, folder); tests pass the contract's mock.
 * @returns {import('express').Router}
 */
export function createLineImportAgentRouter({ getRoot, clientOrigin, planServiceFor, agentFor }) {
  const agents = new Map();
  const reason = createReasonProvider();
  const forFolder = agentFor ?? ((root, folder) => {
    const key = `${root}\u0000${folder}`;
    if (!agents.has(key)) {
      agents.set(key, createImportAgentOnDisk({ root, folder, planService: planServiceFor(root), reason, verify: verifyImport, baseline: lineBaseline }));
    }
    return agents.get(key);
  });
  const router = express.Router();
  router.use('/import-agent', (req, res, next) => {
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
    const body = req.method === 'GET' ? { folder: req.query.folder } : plain(req.body);
    const bad = folderProblem(body.folder);
    if (bad) return res.status(400).json({ ok: false, sentence: `The import folder ${bad}.`, code: 'BAD_FOLDER' });
    try {
      if (!agentFor) folderRootOf(r.root, body.folder);
      const out = await fn(forFolder(r.root, body.folder), body);
      return out.ok === false ? res.status(400).json(out) : res.json(out);
    } catch (e) {
      if (/** @type {any} */ (e)?.name === 'LineOpError') return res.status(400).json({ ok: false, sentence: /** @type {any} */ (e).sentence, code: /** @type {any} */ (e).code });
      return res.status(500).json({ ok: false, sentence: 'Cockpit could not do that with the import; nothing was changed.', code: 'INTERNAL' });
    }
  };
  router.get('/import-agent', handle((agent) => agent.view()));
  router.post('/import-agent/start', handle((agent, b) => agent.start('ui', { route: typeof b.route === 'string' ? b.route : undefined })));
  router.post('/import-agent/resume', handle((agent) => agent.resume('ui')));
  router.post('/import-agent/pause', handle((agent) => agent.pause('ui')));
  router.post('/import-agent/step', handle((agent, b) => agent.editStep('ui', { action: b.action, stepId: b.stepId, args: plain(b.args), to: b.to })));
  router.post('/import-agent/answer', handle((agent, b) => agent.answer('ui', b.questionId, b.optionId)));
  return router;
}
