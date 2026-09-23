// #590 (part of #577's Cockpit-files row) -- through the real route table: every Pages editor write
// REQUIRES the contentHash the client got when it loaded the page. No hash is 400 HASH_REQUIRED, a
// hash for an older copy of the file is 409 CHANGED_ON_DISK, and in both cases the file on disk is
// untouched; the matching hash saves exactly as before. This is the same contract componentSave
// (componentsApi.mjs) already answers, so a client can handle both editors' saves the same way.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';

const sandbox = makeTempDir('pages-hash-');
process.env.CONSTRUCT_WORKSPACE_ROOT = path.join(sandbox, 'ws');
process.env.CONSTRUCT_STATE_DIR = path.join(sandbox, 'state');
fs.mkdirSync(process.env.CONSTRUCT_WORKSPACE_ROOT);
delete process.env.CONSTRUCT_GITHUB_CLIENT_ID;
delete process.env.CONSTRUCT_GITHUB_CLIENT_SECRET;
delete process.env.CONSTRUCT_E2E_PROJECT_DIR;

const { app } = await import('./index.mjs');
const { workspaceRoot } = await import('./workspace.mjs');

const PAGE = `import type { ReactNode } from 'react';

export default function HomePage({ title }: { title: string }): ReactNode {
  return (
    <main>
      <h1>{title}</h1>
    </main>
  );
}
`;

let server;
let base;
let pagePath;

const call = (method, url, body) => fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const ref = { feature: 'billing', file: 'HomePage.tsx' };
const q = '?feature=billing&file=HomePage.tsx';
const freshHash = async () => (await (await call('GET', `/api/pages/tree${q}`)).json()).contentHash;

before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const projectDir = path.join(workspaceRoot(), 'cx');
  fs.mkdirSync(projectDir);
  await call('POST', '/api/settings', { projectDir: 'cx' });
  assert.equal((await call('POST', '/api/init', {})).status, 200);
  await call('POST', '/api/create', { kind: 'single', name: 'Home', feature: 'billing', layer: 'page' });
  pagePath = path.join(projectDir, 'features/billing/pages/HomePage.tsx');
  fs.writeFileSync(pagePath, PAGE);
});

after(() => {
  server.close();
});

// Every write route, with the body that would succeed once the hash is right. Each is exercised
// with the hash left out and with a stale one; the disk must not move in either case.
const WRITES = [
  ['/api/pages/node', { ...ref, nodeId: 'n1', snippet: '<h1>Changed</h1>' }],
  ['/api/pages/props', { ...ref, nodeId: 'n0', propName: 'id', kind: 'string', value: 'x' }],
  ['/api/pages/automap', { ...ref, nodeId: 'n1', propNames: ['title'] }],
  ['/api/pages/palette/insert', { ...ref, kind: 'component', name: 'Nope', path: 'features/billing/components/Nope.tsx' }],
  ['/api/pages/palette/wrap', { ...ref, nodeId: 'n1', name: 'Thing' }],
];

for (const [url, body] of WRITES) {
  test(`${url}: no contentHash is refused with 400 HASH_REQUIRED and writes nothing (#590)`, async () => {
    const before = fs.readFileSync(pagePath, 'utf8');
    for (const contentHash of [undefined, '', null]) {
      const res = await call('POST', url, contentHash === undefined ? body : { ...body, contentHash });
      const json = await res.json();
      assert.equal(res.status, 400, `${url} ${String(contentHash)}: ${JSON.stringify(json)}`);
      assert.equal(json.ok, false);
      assert.equal(json.code, 'HASH_REQUIRED');
      assert.match(json.error, /contentHash is required/);
    }
    assert.equal(fs.readFileSync(pagePath, 'utf8'), before, 'the file is untouched');
  });

  test(`${url}: a stale contentHash is refused with 409 CHANGED_ON_DISK and writes nothing (#590)`, async () => {
    const before = fs.readFileSync(pagePath, 'utf8');
    const res = await call('POST', url, { ...body, contentHash: 'deadbeef' });
    const json = await res.json();
    assert.equal(res.status, 409, `${url}: ${JSON.stringify(json)}`);
    assert.equal(json.ok, false);
    assert.equal(json.code, 'CHANGED_ON_DISK');
    assert.match(json.error, /changed on disk/);
    assert.equal(fs.readFileSync(pagePath, 'utf8'), before, 'the file is untouched');
  });
}

test('/api/pages/node: the hash from the tree load saves, and the response carries the new hash + tree (#590 unchanged on match)', async () => {
  const contentHash = await freshHash();
  const res = await call('POST', '/api/pages/node', { ...ref, nodeId: 'n1', snippet: '<h1>Changed</h1>', contentHash });
  const json = await res.json();
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.equal(json.ok, true);
  assert.match(fs.readFileSync(pagePath, 'utf8'), /<h1>Changed<\/h1>/);
  assert.ok(json.contentHash && json.contentHash !== contentHash, 'a new hash for the new text');
  assert.ok(Array.isArray(json.roots));
  // The hash just used is now stale: the same body again is a 409, not a second write.
  const again = await call('POST', '/api/pages/node', { ...ref, nodeId: 'n1', snippet: '<h1>Again</h1>', contentHash });
  assert.equal(again.status, 409);
  assert.equal((await again.json()).code, 'CHANGED_ON_DISK');
  assert.match(fs.readFileSync(pagePath, 'utf8'), /<h1>Changed<\/h1>/);
});

test('/api/pages/props: the matching hash saves the prop edit (#590 unchanged on match)', async () => {
  const contentHash = await freshHash();
  const res = await call('POST', '/api/pages/props', { ...ref, nodeId: 'n0', propName: 'id', kind: 'string', value: 'home', contentHash });
  const json = await res.json();
  assert.equal(res.status, 200, JSON.stringify(json));
  assert.match(fs.readFileSync(pagePath, 'utf8'), /<main id="home">/);
});
