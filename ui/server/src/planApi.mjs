// #289 / #332 — REST surface for Plan mode. Mount AFTER `app.use('/api', auth.requireSession)` (index.mjs
// does). Reads are GET; validating, analysing and running take a body, so they are POST (a cross-site
// request cannot carry the SameSite=Lax session cookie). Logic and security live in planService.mjs.
import express from 'express';

export function createPlanRouter(service) {
  const router = express.Router();
  const send = (res, { status, body }) => res.status(status).json(body);
  const bodyOf = (req) => (req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {});

  router.get('/context', (req, res) => send(res, service.context()));
  router.post('/propose', (req, res) => send(res, service.propose(bodyOf(req))));
  router.post('/impact', (req, res) => send(res, service.impact(bodyOf(req))));
  router.post('/validate', (req, res) => send(res, service.validate(bodyOf(req))));
  // Starting work is the one mutation here. If the session gate did not run, refuse rather than guess.
  router.post('/run', (req, res) => {
    if (req.session === undefined) return res.status(401).json({ ok: false, error: 'Authentication required.' });
    return send(res, service.run(bodyOf(req)));
  });
  router.use((req, res) => res.status(404).json({ ok: false, error: 'Not found.' }));
  return router;
}
