// #378 — REST surface for the target app's dev server (see devServer.mjs).
//
// Mount this AFTER `app.use('/api', auth.requireSession)` (index.mjs does), so every route sits behind the
// session gate. Reads are GETs; every call that starts or stops project code is a POST from the Cockpit's own
// origin (a foreign browser Origin is refused, the same rule /api/logs applies), and nothing here starts a
// server unless a client asks for it by name: there is no auto-start, no "start on open", no default.
import express from 'express';

export function createDevServerRouter(service, { clientOrigin } = {}) {
  const router = express.Router();
  const sameOrigin = (req) => {
    const origin = req.get('origin');
    return !origin || !clientOrigin || origin === clientOrigin;
  };
  const act = (fn) => async (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ ok: false, error: 'Origin not allowed.' });
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    try {
      const { status, body: out } = await fn(body);
      return res.status(status).json(out);
    } catch (e) {
      return res.status(500).json({ ok: false, error: e.message });
    }
  };

  router.get('/', (req, res) => {
    if (!sameOrigin(req)) return res.status(403).json({ ok: false, error: 'Origin not allowed.' });
    return res.json(service.status());
  });
  router.post('/start', act((b) => service.start({ port: b.port })));
  router.post('/restart', act((b) => service.restart({ port: b.port })));
  router.post('/stop', act(() => service.stop()));
  router.use((req, res) => res.status(404).json({ ok: false, error: 'Not found.' }));
  return router;
}
