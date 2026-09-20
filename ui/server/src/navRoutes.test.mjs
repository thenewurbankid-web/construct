// The real route table + the real session gate: the navigation routes must answer 401 without a
// session (they read project files on a machine that runs commands) and sit below the gate.
import '../../../test-utils/workspaceRoot.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

process.env.CONSTRUCT_GITHUB_CLIENT_ID = 'client-id';
process.env.CONSTRUCT_GITHUB_CLIENT_SECRET = 'client-secret';
process.env.CONSTRUCT_ALLOWED_LOGINS = 'owner-login';
process.env.CONSTRUCT_SESSION_SECRET = 'x'.repeat(48);
delete process.env.CONSTRUCT_E2E_LOGIN;

const { app } = await import('./index.mjs');

async function withServer(fn) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    server.close();
  }
}

test('unauthenticated /api/nav/page and /api/nav/open are refused with 401', async () => {
  await withServer(async (base) => {
    const page = await fetch(`${base}/api/nav/page?feature=catalog&file=HomePage.tsx`);
    assert.equal(page.status, 401);
    const open = await fetch(`${base}/api/nav/open`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: 'features/a/pages/A.tsx', ref: 'X' }) });
    assert.equal(open.status, 401);
    assert.equal((await open.json()).code, 'auth_required');
  });
});

test('the nav routes are registered after the session gate in index.mjs', () => {
  const src = fs.readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
  const gate = src.indexOf("app.use('/api', auth.requireSession)");
  assert.ok(gate > 0);
  for (const route of ["'/api/nav/page'", "'/api/nav/open'"]) assert.ok(src.indexOf(route) > gate, `${route} must come after the gate`);
});

test('unauthenticated /api/flow/:feature and /api/nav/file are refused with 401 (#328)', async () => {
  await withServer(async (base) => {
    for (const url of ['/api/flow/billing', '/api/flow/..%2Fx', '/api/nav/file?feature=billing&path=src/App.tsx']) {
      const res = await fetch(`${base}${url}`);
      assert.equal(res.status, 401, url);
      assert.equal((await res.json()).code, 'auth_required');
    }
  });
});

test('the flow routes are registered after the session gate in index.mjs (#328)', () => {
  const src = fs.readFileSync(new URL('./index.mjs', import.meta.url), 'utf8');
  const gate = src.indexOf("app.use('/api', auth.requireSession)");
  for (const route of ["'/api/flow/:feature'", "'/api/nav/file'"]) assert.ok(src.indexOf(route) > gate, `${route} must come after the gate`);
});
