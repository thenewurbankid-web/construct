// #292 — REST surface for the Processes drawer.
//
// Mount this AFTER `app.use('/api', auth.requireSession)` (index.mjs does).
// Reads are GETs; every control that changes a process is a POST, so the
// SameSite=Lax session cookie is never sent on a cross-site state change and
// no GET ever mutates anything.
import express from 'express';

export function createProcessesRouter(service) {
  const router = express.Router();
  const send = (res, { status, body }) => res.status(status).json(body);

  router.get('/', (req, res) => {
    res.json({ ok: true, ...service.list() });
  });

  router.get('/:id', (req, res) => send(res, service.detail(req.params.id)));

  router.get('/:id/diff', (req, res) => {
    const filePath = typeof req.query.path === 'string' ? req.query.path : '';
    if (!filePath) return res.status(400).json({ ok: false, error: 'A `path` query parameter is required.' });
    return send(res, service.artifactDiff(req.params.id, filePath));
  });

  // Mutating: POST only. The verb is looked up in a closed list; the machine
  // then decides whether it is legal for the process's current state.
  router.post('/:id/:verb', (req, res) => send(res, service.control(req.params.id, req.params.verb)));

  router.use((req, res) => res.status(404).json({ ok: false, error: 'Not found.' }));
  return router;
}
