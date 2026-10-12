// The Line Cockpit API (packages/engine/line/contract.mjs LINE_API), mounted at /api/line below the session
// gate (index.mjs). This part serves the read-only views only: GET /api/line/project answers the contract's
// LineProject for the open project (readLineProject, packages/engine/line/model.mjs), and GET /api/line/feature?name=
// one feature's LineFeatureDetail (readLineFeature, packages/engine/line/feature.mjs), and GET /api/line/workflows?feature=
// its workflows (cw1, readLineWorkflows in packages/engine/line/workflows.mjs). The write
// routes (base-on, promote, page-prop) are added beside it and go through applyChange (the writer) only.
// Errors are one plain-English sentence: a LineOpError becomes 400 {ok:false, sentence, code}.
import express from 'express';
import { LineOpError } from '../../../packages/engine/line/contract.mjs';
import { readLineProject } from '../../../packages/engine/line/model.mjs';
import { readLineFeature } from '../../../packages/engine/line/feature.mjs';
import { readLineWorkflows } from '../../../packages/engine/line/workflows.mjs';
import { readLineComponent } from '../../../packages/engine/line/components.mjs';

/**
 * @param {{getRoot: () => ({ok: true, root: string} | {ok: false, error: string}),
 *   readProject?: (root: string) => import('../../../packages/engine/line/contract.mjs').LineProject,
 *   readFeature?: (root: string, name: string) => import('../../../packages/engine/line/contract.mjs').LineFeatureDetail,
 *   readWorkflows?: (root: string, feature: string) => import('../../../packages/engine/line/contract.mjs').LineWorkflowList,
 *   readComponent?: (root: string, file: string) => any}} deps
 *   `readProject`, `readFeature` and `readWorkflows` default to the real model; tests pass the contract's mock.
 * @returns {import('express').Router}
 */
export function createLineRouter({ getRoot, readProject = readLineProject, readFeature = readLineFeature, readWorkflows = readLineWorkflows, readComponent = readLineComponent }) {
  const router = express.Router();
  /** One read route: no project, a refusal and a crash are each one sentence. */
  const read = (fn, failed) => (req, res) => {
    const r = getRoot();
    if (!r.ok) return res.status(400).json({ ok: false, code: 'NO_PROJECT', sentence: r.error });
    try {
      return res.json(fn(r.root, req));
    } catch (e) {
      if (e instanceof LineOpError) return res.status(400).json({ ok: false, code: e.code, sentence: e.sentence });
      return res.status(500).json({ ok: false, code: 'READ_FAILED', sentence: failed });
    }
  };
  router.get('/project', read((root) => readProject(root), 'Cockpit could not read this project as a Line project.'));
  router.get('/feature', read((root, req) => {
    const name = typeof req.query.name === 'string' ? req.query.name : '';
    if (!/^[A-Za-z0-9][\w.-]*$/.test(name)) throw new LineOpError('Name the feature to show, for example ?name=orders.', 'BAD_REQUEST');
    return readFeature(root, name);
  }, 'Cockpit could not read this feature.'));
  // cw1: the feature's workflows, the library's and the feature's pages (workflows.mjs). Changes are plan steps.
  router.get('/workflows', read((root, req) => {
    const feature = typeof req.query.feature === 'string' ? req.query.feature : '';
    if (!/^[A-Za-z0-9][\w.-]*$/.test(feature)) throw new LineOpError('Name the feature whose workflows to show, for example ?feature=orders.', 'BAD_REQUEST');
    return readWorkflows(root, feature);
  }, 'Cockpit could not read this feature\'s workflows.'));
  // cu4: one component for the Components editor (Behaviour, Events, States; components.mjs). Changes are plan steps.
  router.get('/component', read((root, req) => {
    const file = typeof req.query.file === 'string' ? req.query.file : '';
    if (!file || file.includes('..') || file.startsWith('/')) throw new LineOpError('Name the component to open, for example ?file=features/orders/components/OrderButton.tsx.', 'BAD_REQUEST');
    return readComponent(root, file);
  }, 'Cockpit could not read this component.'));
  return router;
}
