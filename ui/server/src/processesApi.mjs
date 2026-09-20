// #292 — REST surface for the Processes drawer.
//
// Mount this AFTER `app.use('/api', auth.requireSession)` (index.mjs does).
// Reads are GETs; every control that changes a process is a POST, so the
// SameSite=Lax session cookie is never sent on a cross-site state change and
// no GET ever mutates anything.
import express from 'express';

/** The audit name recorded when authentication is off (loopback only). */
export const LOCAL_ACTOR = 'local';

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

  // #341 — the approval gate. Review is a read-only GET.
  router.get('/:id/review', (req, res) => send(res, service.review(req.params.id)));

  // Decide is a mutating POST, ONE decision on ONE file per request (there is deliberately no bulk form).
  // `by` is the signed-in login from the server-side session (`req.session`, set by auth.requireSession),
  // or the fixed "local" when authentication is off on loopback. It is never read from the body, the query
  // or a header. If the session gate did not run (`req.session` undefined) this refuses rather than guesses.
  // `diffSha256` is passed through exactly as the client echoed it and is never computed here.
  router.post('/:id/decide', (req, res) => {
    if (req.session === undefined) return res.status(401).json({ ok: false, error: 'Authentication required.' });
    const by = req.session ? req.session.login : LOCAL_ACTOR;
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const { path, verdict } = body;
    const diffSha256 = body.diffSha256 ?? undefined; // a reject (or an already-decided file) carries no hash
    if (typeof path !== 'string' || !['approve', 'reject'].includes(verdict)) {
      return res.status(400).json({ ok: false, error: 'A decision needs a string `path` and a `verdict` of "approve" or "reject". One file at a time; there is no approve-all.' });
    }
    if (diffSha256 !== undefined && typeof diffSha256 !== 'string') {
      return res.status(400).json({ ok: false, error: '`diffSha256` must be the hash of the diff that was shown.' });
    }
    return send(res, service.decide(req.params.id, { by, path, verdict, diffSha256 }));
  });

  // Mutating: POST only. The verb is looked up in a closed list; the machine
  // then decides whether it is legal for the process's current state.
  router.post('/:id/:verb', (req, res) => send(res, service.control(req.params.id, req.params.verb)));

  router.use((req, res) => res.status(404).json({ ok: false, error: 'Not found.' }));
  return router;
}
