// #407 through the REAL route table (index.mjs): /api/blocks sits below the session gate, answers NO_PROJECT until a
// project is open, and the plan check the real server uses refuses a step whose block is turned off, so no process is
// created. (The stack tests in blocksApi.test.mjs prove the same with injected wiring; this proves index.mjs wires it.)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const sandbox = makeTempDir('blocksroutes-');
process.env.CONSTRUCT_WORKSPACE_ROOT = path.join(sandbox, 'ws');
process.env.CONSTRUCT_STATE_DIR = path.join(sandbox, 'state');
fs.mkdirSync(process.env.CONSTRUCT_WORKSPACE_ROOT, { recursive: true });
fs.cpSync(path.join(REPO, 'fixtures', 'impact-shared'), path.join(process.env.CONSTRUCT_WORKSPACE_ROOT, 'proj'), { recursive: true });
delete process.env.CONSTRUCT_GITHUB_CLIENT_ID;
delete process.env.CONSTRUCT_GITHUB_CLIENT_SECRET;
delete process.env.CONSTRUCT_E2E_PROJECT_DIR;

const { app, planService } = await import('./index.mjs');

let server;
let base;
before(async () => {
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const call = async (method, url, body, headers = {}) => {
  const r = await fetch(`${base}${url}`, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const unit = { id: 's1', title: 'Add Cart', flow: 'create.unit', args: { layer: 'domain', name: 'Cart', feature: 'billing' }, executor: 'deterministic', touches: { features: ['billing'] } };
const plan = { version: 1, ticket: { source: 'text', title: 'Add a cart' }, steps: [unit] };

test('no project open: /api/blocks answers 409 NO_PROJECT for GET and PUT', async () => {
  for (const [method, body] of [['GET'], ['PUT', { rev: 0, blocks: {} }]]) {
    const r = await call(method, '/api/blocks', body);
    assert.equal(r.status, 409, method);
    assert.equal(r.body.code, 'NO_PROJECT');
  }
});

test('with a project open: turn create.unit off through the API, and the real plan check refuses it; on again, it is valid', async () => {
  assert.equal((await call('POST', '/api/settings', { projectDir: 'proj' })).status, 200);
  const first = await call('GET', '/api/blocks');
  assert.equal(first.status, 200);
  assert.equal(first.body.blocks.length, 34);
  assert.equal(first.body.rev, 0);

  const before = await call('POST', '/api/plan/validate', { plan });
  assert.equal(before.body.valid, true, JSON.stringify(before.body.errors));

  const off = await call('PUT', '/api/blocks', { rev: 0, blocks: { 'create.unit': { enabled: false } } });
  assert.equal(off.status, 200);
  assert.equal(off.body.blocks.find((b) => b.id === 'create.unit').settings.enabled, false);

  const refused = await call('POST', '/api/plan/run', { plan });
  assert.equal(refused.status, 400);
  assert.ok(refused.body.errors.some((e) => e.code === 'COCKPIT_BLOCK_DISABLED'));
  assert.deepEqual(planService.validate({ plan }).body.errors.map((e) => e.code), ['COCKPIT_BLOCK_DISABLED'], 'the exported service the server uses agrees');
  const listed = await call('GET', '/api/processes');
  assert.deepEqual(listed.body.processes ?? [], [], 'the refused run created no process');

  // The settings live in the state directory, never in the project.
  assert.ok(fs.readdirSync(path.join(process.env.CONSTRUCT_STATE_DIR, 'block-settings')).length === 1);
  assert.equal(fs.existsSync(path.join(process.env.CONSTRUCT_WORKSPACE_ROOT, 'proj', 'block-settings')), false);

  assert.equal((await call('PUT', '/api/blocks', { rev: 1, blocks: { 'create.unit': { enabled: true } } })).status, 200);
  assert.equal((await call('POST', '/api/plan/validate', { plan })).body.valid, true);
});

test('the app-wide 100 KB parser is stepped aside for /api/blocks: this router\'s own 16 KiB cap answers 413', async () => {
  const r = await call('PUT', '/api/blocks', { rev: 2, blocks: {}, pad: 'x'.repeat(20 * 1024) });
  assert.equal(r.status, 413);
  assert.equal(r.body.code, 'TOO_LARGE');
});
