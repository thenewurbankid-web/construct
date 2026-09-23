// #378 + #224 — the external-change safety net still holds when the thing that changes a file is a process the
// dev server started. Nothing in the change tracker (content hash, file-change-tracker.mjs) knows or cares WHO
// wrote a file, only that the disk no longer matches what the editor showed; this proves it for a real dev-server
// child process (a codegen/format-on-save style write), through the real route table: the change is reported as a
// diff, an edit built on the old tree is refused instead of silently overwriting it, dismiss clears it, and the
// editor's own save is never reported as an external change.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';

const sandbox = makeTempDir('devsrv-chg-');
process.env.CONSTRUCT_WORKSPACE_ROOT = path.join(sandbox, 'ws');
process.env.CONSTRUCT_STATE_DIR = path.join(sandbox, 'state');
process.env.CONSTRUCT_DEV_SERVER_PORT_BASE = '47800';
fs.mkdirSync(process.env.CONSTRUCT_WORKSPACE_ROOT);
delete process.env.CONSTRUCT_GITHUB_CLIENT_ID;
delete process.env.CONSTRUCT_GITHUB_CLIENT_SECRET;
delete process.env.CONSTRUCT_E2E_PROJECT_DIR;

const { app, devServer } = await import('./index.mjs');
const { workspaceRoot } = await import('./workspace.mjs');

const PAGE_BEFORE = `import type { ReactNode } from 'react';

export default function HomePage({ title }: { title: string }): ReactNode {
  return (
    <main>
      <h1>{title}</h1>
    </main>
  );
}
`;
const PAGE_AFTER = PAGE_BEFORE.replace('<h1>{title}</h1>', '<h1>{title}</h1>\n      <p>Edited by the dev server</p>');

// A dev server that, like a codegen or format-on-save plugin, rewrites a source file in the project when asked.
const FIXTURE_SERVER = `import http from 'node:http';
import fs from 'node:fs';
const page = 'features/billing/pages/HomePage.tsx';
const after = ${JSON.stringify(PAGE_AFTER)};
const srv = http.createServer((q, r) => {
  if (q.url === '/rewrite') fs.writeFileSync(page, after);
  r.end('ok');
});
srv.listen(Number(process.env.PORT), '127.0.0.1', () => console.log('  Local:   http://localhost:' + process.env.PORT + '/'));
process.on('SIGTERM', () => srv.close(() => process.exit(0)));
`;

let server;
let base;
let projectDir;
let pagePath;

const call = (method, url, body) => fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const q = '?feature=billing&file=HomePage.tsx';
const until = async (fn, ms = 30_000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
};

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  projectDir = path.join(workspaceRoot(), 'cx');
  fs.mkdirSync(projectDir);
  await call('POST', '/api/settings', { projectDir: 'cx' });
  assert.equal((await call('POST', '/api/init', {})).status, 200);
  await call('POST', '/api/create', { kind: 'single', name: 'Home', feature: 'billing', layer: 'page' });
  pagePath = path.join(projectDir, 'features/billing/pages/HomePage.tsx');
  fs.writeFileSync(pagePath, PAGE_BEFORE);
  fs.writeFileSync(path.join(projectDir, 'server.mjs'), FIXTURE_SERVER);
  fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { dev: 'node server.mjs' } }));
});

after(async () => {
  await devServer.stopAll();
  server.close();
});

test('a file rewritten by the dev server\'s own process is reported as an external change, and a stale edit is refused', async () => {
  // The editor opens the page: this is the baseline the change is measured against.
  const tree = await (await call('GET', `/api/pages/tree${q}`)).json();
  assert.equal((await (await call('GET', `/api/pages/changes${q}`)).json()).change, null);

  await call('POST', '/api/dev-server/start', {});
  const running = await until(async () => { const s = await (await call('GET', '/api/dev-server')).json(); return s.state === 'running' ? s : null; });

  // The dev server (a child process of the Cockpit server, not the editor) rewrites the page behind its back.
  assert.equal(await (await fetch(`${running.url}rewrite`)).text(), 'ok');
  assert.equal(fs.readFileSync(pagePath, 'utf8'), PAGE_AFTER);

  const { change } = await (await call('GET', `/api/pages/changes${q}`)).json();
  assert.ok(change, 'the change is reported');
  assert.deepEqual(change.stats, { added: 1, removed: 0 });
  assert.ok(change.rows.some((r) => r.kind === 'added' && /Edited by the dev server/.test(r.text)), 'as a real diff');

  // An edit built on the tree the editor showed BEFORE the rewrite is refused, not silently applied over it.
  const stale = await call('POST', '/api/pages/node', { feature: 'billing', file: 'HomePage.tsx', nodeId: 'n1', snippet: '<h1>Mine</h1>', contentHash: tree.contentHash });
  assert.equal(stale.status, 409);
  assert.match((await stale.json()).error, /changed on disk/);
  assert.equal(fs.readFileSync(pagePath, 'utf8'), PAGE_AFTER, 'the dev server\'s version is untouched');

  // Dismiss clears it; the next read of the same disk state does not bring it back.
  assert.equal((await call('POST', '/api/pages/changes/dismiss', { feature: 'billing', file: 'HomePage.tsx' })).status, 200);
  assert.equal((await (await call('GET', `/api/pages/changes${q}`)).json()).change, null);

  // Reloading the tree gives a fresh hash, and an edit on it is accepted; the editor's own write is not "external".
  const fresh = await (await call('GET', `/api/pages/tree${q}`)).json();
  const saved = await call('POST', '/api/pages/node', { feature: 'billing', file: 'HomePage.tsx', nodeId: 'n1', snippet: '<h1>Mine</h1>', contentHash: fresh.contentHash });
  assert.equal(saved.status, 200);
  assert.match(fs.readFileSync(pagePath, 'utf8'), /<h1>Mine<\/h1>/);
  assert.equal((await (await call('GET', `/api/pages/changes${q}`)).json()).change, null, 'the editor\'s own save is never reported as external');

  await call('POST', '/api/dev-server/stop', {});
});
