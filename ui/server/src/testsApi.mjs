// #300/#301 -- the Tests tab's REST surface: list a feature's tests with the scenario coverage table, read one
// test, clone a locked generated test, and (re)generate a feature's locked tests.
//
// Mount AFTER `app.use('/api', auth.requireSession)` (index.mjs does). Endpoints:
//   GET  /:feature                          generated (locked) and yours, plus a coverage row per scenario
//   GET  /:feature/source?area=&name=       read-only text of one listed test ("Just show me the code")
//   GET  /:feature/compare?name=            one of YOUR clones against the flow as it is now: stale or not, and what changed (#306, read-only)
//   POST /:feature/clone {source, name?}    copy ONE generated test to features/<f>/tests/<name>.spec.ts
//   POST /:feature/generate                 construct generate tests <feature> (the #348 generator)
//   GET  /:feature/steps?name=              one of YOUR tests as a step document (#302), with the hash to echo back
//   POST /:feature/steps/preview {name, baseHash, steps}            validate + render an edit; returns the diff, writes nothing
//   POST /:feature/steps {name, baseHash, resultSha, steps}         write the previewed edit (needs the hash AND the reviewed sha)
//
// Security, in one place (the client supplies ONLY a feature name, a file NAME and a clone name):
//   - the feature is compared against the REAL feature list of the current project (listUnits); it never
//     becomes a path until the core has re-validated it;
//   - the project is always the server's current one; no request field is ever a project or file path;
//   - the source must be an existing regular file in that feature's generated/ directory, the clone name is
//     ^[a-z0-9][a-z0-9-]*$, the destination is derived in src/engine/testClone.mjs, symlinks are refused,
//     and nothing is overwritten (see there);
//   - step edits (#302): the client sends a file NAME (^[a-z0-9][a-z0-9-]*\.spec\.ts$, an existing non-symlink file
//     directly under tests/, never generated/) and step FIELDS. Every field is validated against an allowlist in
//     src/engine/testSteps.mjs and rendered through escaped template slots; the write needs the content hash the
//     user opened and the sha of the diff they reviewed, and is an atomic O_EXCL temp + rename;
//   - both POSTs are mutating: they sit behind the session gate, need a JSON body and, when the browser sends
//     an Origin, that Origin must be the Cockpit's own.
import express from 'express';
import { listUnits } from '../../../src/engine/unitSummary.mjs';
import { cloneGeneratedTest, readFeatureTest } from '../../../src/engine/testClone.mjs';
import { compareClone, listFeatureTestsFresh } from '../../../src/engine/testFreshness.mjs';
import { generateFeatureTests } from '../../../src/engine/testGenerator.mjs';
import { applyStepEdit, previewStepEdit, readStepDocument } from '../../../src/engine/testSteps.mjs';
import { environmentState } from './testsEnv.mjs';
import { ConstructError } from '../../../src/diagnostics.mjs';

const NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,99}$/;
const STATUS = { 'no-feature': 404, 'not-generated': 404, 'not-found': 404, 'not-a-clone': 422, 'bad-name': 400, exists: 409, locked: 403, stale: 409, 'not-reviewed': 409, 'no-change': 409, invalid: 422, 'not-editable': 422, unrenderable: 422 };
const refuse = (status, error, extra = {}) => ({ status, body: { ok: false, error, ...extra } });

/** The current project's real feature, or a refusal. Only ever COMPARES the client's string. */
function checkFeature(root, feature) {
  if (typeof feature !== 'string' || !feature || feature.includes('\0') || !NAME.test(feature)) return refuse(400, 'That is not a feature name.');
  const listed = listUnits(root, { kind: 'feature' });
  if (!listed.ok || !listed.units.some((u) => u.id === feature)) return refuse(404, `No feature named "${feature}" in this project.`);
  return null;
}

const fromCore = (r) => (r.ok ? { status: 200, body: r } : { status: STATUS[r.code] ?? 400, body: r });

/** @param {{getRoot: () => {ok:true, root:string} | {ok:false, error:string}, clientOrigin?: string}} deps */
export function createTestsRouter({ getRoot, clientOrigin }) {
  const router = express.Router();
  router.use((req, res, next) => {
    if (req.method === 'POST') {
      const origin = req.get('origin');
      if (clientOrigin && origin && origin !== clientOrigin) return res.status(403).json({ ok: false, error: 'This request came from a page that is not the Cockpit.' });
      if (!req.is('application/json')) return res.status(415).json({ ok: false, error: 'Send a JSON body.' });
    }
    return next();
  });

  const handle = (fn) => (req, res) => {
    const r = getRoot();
    if (!r.ok) return res.status(400).json({ ok: false, error: r.error });
    const bad = checkFeature(r.root, req.params.feature);
    if (bad) return res.status(bad.status).json(bad.body);
    try {
      const out = fn(r.root, req);
      return res.status(out.status).json(out.body);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  };
  const body = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});

  router.get('/:feature', handle((root, req) => {
    const r = listFeatureTestsFresh(root, req.params.feature);
    return fromCore(r.ok ? { ...r, environment: environmentState() } : r);
  }));

  router.get('/:feature/source', handle((root, req) => {
    const one = (v) => (typeof v === 'string' ? v : '');
    return fromCore(readFeatureTest(root, req.params.feature, { area: one(req.query.area), name: one(req.query.name) }));
  }));

  router.get('/:feature/compare', handle((root, req) => fromCore(compareClone(root, req.params.feature, { name: typeof req.query.name === 'string' ? req.query.name : undefined }))));

  router.post('/:feature/clone', handle((root, req) => {
    const b = body(req);
    return fromCore(cloneGeneratedTest(root, { feature: req.params.feature, source: b.source, ...(b.name === undefined ? {} : { name: b.name }) }));
  }));

  router.get('/:feature/steps', handle((root, req) => fromCore(readStepDocument(root, { feature: req.params.feature, name: typeof req.query.name === 'string' ? req.query.name : undefined }))));

  router.post('/:feature/steps/preview', handle((root, req) => {
    const b = body(req);
    return fromCore(previewStepEdit(root, { feature: req.params.feature, name: b.name, baseHash: b.baseHash, steps: b.steps }));
  }));

  router.post('/:feature/steps', handle((root, req) => {
    const b = body(req);
    return fromCore(applyStepEdit(root, { feature: req.params.feature, name: b.name, baseHash: b.baseHash, resultSha: b.resultSha, steps: b.steps }));
  }));

  router.post('/:feature/generate', handle((root, req) => {
    try {
      const r = generateFeatureTests(root, req.params.feature);
      return { status: 200, body: { ok: true, written: r.written, unchanged: r.unchanged, skipped: r.skipped, truncated: r.truncated } };
    } catch (e) {
      // The generator refuses (with the exact YAML to add) when the lock is not declared: show it as it is.
      if (e instanceof ConstructError) return { status: 400, body: { ok: false, code: 'generator-refused', error: e.message } };
      throw e;
    }
  }));

  return router;
}
