// #407 -- the Blocks API and its ENFORCEMENT. Security first (session gate, foreign Origin, JSON only, size, hostile
// bodies), then the contract the Cockpit relies on (rev, catalogue, run counts), then the point of the feature: a plan
// step whose block is turned off is refused with COCKPIT_BLOCK_DISABLED by both /validate and /run, and NOTHING starts.
import '../../../test-utils/workspaceRoot.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { SESSION_COOKIE, createAuth, resolveAuthConfig, signValue } from './auth.mjs';
import { createBlocksRouter, MAX_BLOCKS_REQUEST_BYTES, revFromHeader } from './blocksApi.mjs';
import { createPlanRouter } from './planApi.mjs';
import { createPlanService } from './planService.mjs';
import { openBlockSettingsStore } from './blockSettingsStore.mjs';
import { PLAN_FLOWS } from '../../../packages/core/plan.mjs';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const SHARED = path.join(REPO, 'fixtures', 'impact-shared');
const ORIGIN = 'http://localhost:3000';
const SECRET = 's'.repeat(48);
const ENV = { CONSTRUCT_AUTH: 'required', CONSTRUCT_AUTH_TEST_USER: 'e2e-user', CONSTRUCT_SESSION_SECRET: SECRET };
const cookie = () => `${SESSION_COOKIE}=${encodeURIComponent(signValue({ login: 'e2e-user', exp: Date.now() + 60_000 }, SECRET))}`;

const makeProject = () => {
  const dir = makeTempDir('og407-blocks-');
  fs.cpSync(SHARED, dir, { recursive: true });
  return dir;
};

const step = (over = {}) => ({ id: 's1', title: 'List features', flow: 'summarize.list', args: { kind: 'feature' }, executor: 'deterministic', ...over });
const createUnit = (over = {}) => ({ id: 's1', title: 'Add Cart', flow: 'create.unit', args: { layer: 'domain', name: 'Cart', feature: 'billing' }, executor: 'deterministic', touches: { features: ['billing'] }, ...over });
const plan = (steps = [step()]) => ({ version: 1, ticket: { source: 'text', title: 'A ticket' }, steps });

/** The same wiring index.mjs has: blocks router + plan router over one project and one state directory. */
async function withStack({ root = makeProject(), stateDir = makeTempDir('og407-state-'), open = true, getRuns, getBlockSettings } = {}, fn) {
  const started = [];
  const settingsFor = getBlockSettings ?? ((r) => openBlockSettingsStore(r, { stateDir }).disabledFlows());
  const service = createPlanService({ getRoot: () => root, startPlan: (p) => { started.push(p); return { ok: true, processId: 'p-1' }; }, getBlockSettings: settingsFor });
  const auth = createAuth(resolveAuthConfig(ENV, { host: '127.0.0.1', clientOrigin: ORIGIN }));
  const app = express();
  auth.mountRoutes(app);
  app.use('/api', auth.requireSession);
  const jsonBody = express.json();
  app.use((req, res, next) => (req.path === '/api/blocks' ? next() : jsonBody(req, res, next)));
  app.use('/api/plan', createPlanRouter(service));
  app.use('/api/blocks', createBlocksRouter({ clientOrigin: ORIGIN, stateDir, getRuns, getRoot: () => (open ? { ok: true, root } : { ok: false, status: 409, body: { ok: false, code: 'NO_PROJECT' } }) }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const call = (method, p, { body, headers = {}, raw } = {}) => fetch(`http://127.0.0.1:${port}${p}`, {
    method,
    headers: { origin: ORIGIN, cookie: cookie(), ...(body !== undefined || raw !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(raw !== undefined ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = async (method, p, opts) => { const r = await call(method, p, opts); return { status: r.status, body: await r.json() }; };
  const put = (blocks, rev, extra = {}) => json('PUT', '/api/blocks', { body: { rev, blocks }, ...extra });
  try {
    await fn({ root, stateDir, started, call, json, put });
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
}

// --- security --------------------------------------------------------------

test('GET and PUT /api/blocks are refused with 401 when there is no session, and nothing is written', async () => {
  await withStack({}, async ({ call, stateDir }) => {
    assert.equal((await call('GET', '/api/blocks', { headers: { cookie: '' } })).status, 401);
    assert.equal((await call('PUT', '/api/blocks', { body: { rev: 0, blocks: { validate: { enabled: false } } }, headers: { cookie: '' } })).status, 401);
    assert.equal(fs.existsSync(path.join(stateDir, 'block-settings')), false);
  });
});

test('a PUT from a foreign Origin is refused (403), a non-JSON body is 415, a huge body 413, bad JSON 400, and nothing is written', async () => {
  await withStack({}, async ({ call, json, stateDir }) => {
    const good = { rev: 0, blocks: { validate: { enabled: false } } };
    assert.equal((await call('PUT', '/api/blocks', { body: good, headers: { origin: 'http://evil.example' } })).status, 403);
    assert.equal((await call('PUT', '/api/blocks', { raw: 'blocks=x', headers: { 'content-type': 'text/plain' } })).status, 415);
    const big = await json('PUT', '/api/blocks', { body: { rev: 0, blocks: {}, pad: 'x'.repeat(20 * 1024) } });
    assert.equal(big.status, 413);
    assert.equal(big.body.code, 'TOO_LARGE');
    assert.equal(MAX_BLOCKS_REQUEST_BYTES, '16kb');
    const bad = await json('PUT', '/api/blocks', { raw: '{"rev": 0, "blocks": {"secret-token-123' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'BAD_JSON');
    assert.ok(!JSON.stringify(bad.body).includes('secret-token-123'), 'the body is never echoed');
    assert.equal(fs.existsSync(path.join(stateDir, 'block-settings')), false);
    assert.deepEqual((await json('GET', '/api/blocks')).body.blocks.filter((b) => !b.settings.enabled), []);
  });
});

test('no project open: 409 NO_PROJECT for both verbs', async () => {
  await withStack({ open: false }, async ({ json }) => {
    assert.equal((await json('GET', '/api/blocks')).status, 409);
    const r = await json('PUT', '/api/blocks', { body: { rev: 0, blocks: {} } });
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'NO_PROJECT');
  });
});

test('only GET and PUT exist on /api/blocks, and an unknown path is a plain 404', async () => {
  await withStack({}, async ({ json }) => {
    for (const [method, p] of [['POST', '/api/blocks'], ['DELETE', '/api/blocks'], ['PATCH', '/api/blocks'], ['GET', '/api/blocks/validate'], ['PUT', '/api/blocks/validate']]) {
      assert.equal((await json(method, p, { body: method === 'GET' ? undefined : {} })).status, 404, `${method} ${p}`);
    }
  });
});

test('hostile PUT bodies are refused with a named code and change nothing', async () => {
  await withStack({}, async ({ json, put, stateDir }) => {
    const cases = [
      [{ nope: { enabled: false } }, 0, 400, 'BLOCK_UNKNOWN'],
      [{ '../../x': { enabled: false } }, 0, 400, 'BLOCK_UNKNOWN'],
      [{ 'pipeline.run': { enabled: false } }, 0, 400, 'BLOCK_NOT_OFFERED'],
      [{ validate: { engine: 'ai' } }, 0, 400, 'BLOCK_AI_UNSUPPORTED'],
      [{ 'manual.task': { engine: 'ai' } }, 0, 400, 'BLOCK_AI_UNSUPPORTED'],
      [{ 'create.unit': { provider: 'claude' } }, 0, 400, 'BLOCK_PROVIDER_NOT_ALLOWED'],
      [{ 'create.unit': { model: '--x' } }, 0, 400, 'BLOCK_FIELD_INVALID'],
      [{ validate: { enabled: 'no' } }, 0, 400, 'BLOCK_FIELD_INVALID'],
      [{ validate: { run: 1 } }, 0, 400, 'BLOCK_FIELD_UNKNOWN'],
      [[], 0, 400, 'BLOCKS_INVALID'],
      ['x', 0, 400, 'BLOCKS_INVALID'],
      [undefined, 0, 400, 'BLOCKS_INVALID'],
      [{ validate: { enabled: false } }, undefined, 400, 'REV_REQUIRED'],
      [{ validate: { enabled: false } }, 'zero', 400, 'REV_REQUIRED'],
      [{ validate: { enabled: false } }, 7, 409, 'STALE_REV'],
    ];
    for (const [blocks, rev, status, code] of cases) {
      const r = await put(blocks, rev);
      assert.equal(r.status, status, `${JSON.stringify(blocks)} rev ${rev}`);
      assert.equal(r.body.code, code);
      assert.equal(r.body.ok, false);
      assert.ok(typeof r.body.error === 'string' && r.body.error.length > 0);
    }
    const proto = await json('PUT', '/api/blocks', { raw: '{"rev":0,"blocks":{"__proto__":{"enabled":false}}}' });
    assert.equal(proto.body.code, 'BLOCK_UNKNOWN');
    assert.equal(({}).enabled, undefined);
    assert.equal(fs.existsSync(path.join(stateDir, 'block-settings')), false, 'no refusal wrote a file');
  });
});

// --- the catalogue and the settings ----------------------------------------

test('GET lists every block once with purpose, reads/writes, model support, arguments, an example, settings and run count', async () => {
  const runs = [{ plan: { steps: [{ id: 'a', flow: 'validate' }, { id: 'b', flow: 'validate' }] }, steps: [{ id: 'a', status: 'done' }, { id: 'b', status: 'failed' }] }];
  await withStack({ getRuns: () => runs }, async ({ json }) => {
    const r = await json('GET', '/api/blocks');
    assert.equal(r.status, 200);
    assert.equal(r.body.rev, 0);
    assert.equal(r.body.unreadable, null);
    assert.equal(r.body.provider, 'ollama');
    assert.deepEqual(r.body.engines, ['mechanical', 'ai']);
    assert.deepEqual(r.body.blocks.map((b) => b.id), Object.keys(PLAN_FLOWS));
    const by = Object.fromEntries(r.body.blocks.map((b) => [b.id, b]));
    assert.equal(by.validate.runs, 2);
    assert.equal(by.sync.runs, 0);
    assert.equal(by.validate.modelCalls, 'none');
    assert.equal(by['create.unit'].modelCalls, 'optional');
    assert.equal(by.validate.writesFiles, false);
    assert.equal(by['create.unit'].writesFiles, true);
    assert.ok(by['create.unit'].example.argv[0] === 'construct');
    assert.ok(r.body.blocks.every((b) => b.purpose && b.reads && b.settings.enabled === true));
  });
});

test('turn a block off, see it in the catalogue, turn it on again; the rev moves on every save and If-Match works', async () => {
  await withStack({}, async ({ json, put }) => {
    const off = await put({ 'create.unit': { enabled: false } }, 0);
    assert.equal(off.status, 200);
    assert.equal(off.body.rev, 1);
    assert.equal(off.body.blocks.find((b) => b.id === 'create.unit').settings.enabled, false);
    assert.equal(off.body.blocks.filter((b) => !b.settings.enabled).length, 1);
    const stale = await put({ validate: { enabled: false } }, 0);
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'STALE_REV');
    assert.equal(stale.body.current.rev, 1, 'a stale save hands back the copy it lost to');
    const viaHeader = await json('PUT', '/api/blocks', { body: { blocks: { 'create.unit': { enabled: true } } }, headers: { 'if-match': '"1"' } });
    assert.equal(viaHeader.status, 200);
    assert.equal(viaHeader.body.rev, 2);
    assert.equal(viaHeader.body.blocks.filter((b) => !b.settings.enabled).length, 0);
    assert.equal(revFromHeader('W/"3"'), 3);
    assert.equal(revFromHeader('abc'), undefined);
  });
});

test('default engine and model save only where the block supports them, and show up in the row', async () => {
  await withStack({}, async ({ put }) => {
    const ok = await put({ 'create.layer': { engine: 'ai', model: 'qwen2.5-coder:7b' } }, 0);
    assert.equal(ok.status, 200);
    assert.deepEqual(ok.body.blocks.find((b) => b.id === 'create.layer').settings, { enabled: true, engine: 'ai', provider: 'ollama', model: 'qwen2.5-coder:7b' });
    const no = await put({ sync: { engine: 'ai' } }, 1);
    assert.equal(no.status, 400);
    assert.equal(no.body.code, 'BLOCK_AI_UNSUPPORTED');
  });
});

// --- enforcement -----------------------------------------------------------

test('a step whose block is turned off is refused by /validate and /run with COCKPIT_BLOCK_DISABLED, and NOTHING starts', async () => {
  await withStack({}, async ({ json, put, started }) => {
    const p = plan([createUnit()]);
    assert.equal((await json('POST', '/api/plan/validate', { body: { plan: p } })).body.valid, true, 'valid while the block is on');
    assert.equal((await put({ 'create.unit': { enabled: false } }, 0)).status, 200);

    const v = await json('POST', '/api/plan/validate', { body: { plan: p } });
    assert.equal(v.body.valid, false);
    const e = v.body.errors.find((x) => x.code === 'COCKPIT_BLOCK_DISABLED');
    assert.ok(e, JSON.stringify(v.body.errors));
    assert.equal(e.path, 'steps[0].flow');
    assert.match(e.plain, /"create\.unit" is turned off for this project/);

    const r = await json('POST', '/api/plan/run', { body: { plan: p } });
    assert.equal(r.status, 400);
    assert.equal(r.body.ok, false);
    assert.ok(r.body.errors.some((x) => x.code === 'COCKPIT_BLOCK_DISABLED'));
    assert.deepEqual(started, [], 'no process was created');
  });
});

test('one disabled step refuses the whole plan (nothing partial starts); other blocks still run; re-enabling runs it', async () => {
  await withStack({}, async ({ json, put, started }) => {
    const mixed = plan([step(), createUnit({ id: 's2', dependsOn: ['s1'] })]);
    await put({ 'create.unit': { enabled: false } }, 0);
    const refused = await json('POST', '/api/plan/run', { body: { plan: mixed } });
    assert.equal(refused.status, 400);
    assert.deepEqual(refused.body.errors.map((x) => x.code), ['COCKPIT_BLOCK_DISABLED']);
    assert.equal(refused.body.errors[0].path, 'steps[1].flow', 'the error names the step that uses the disabled block');
    assert.deepEqual(started, []);

    const other = await json('POST', '/api/plan/run', { body: { plan: plan([step()]) } });
    assert.equal(other.status, 200, 'a block that is still on runs');
    assert.equal(started.length, 1);

    await put({ 'create.unit': { enabled: true } }, 1);
    const again = await json('POST', '/api/plan/run', { body: { plan: mixed } });
    assert.equal(again.status, 200, 'turned back on, the same plan runs');
    assert.equal(started.length, 2);
  });
});

test('every offered block can be turned off and is then refused by name, read-only ones and manual steps included', async () => {
  await withStack({}, async ({ json, put, started }) => {
    const rows = (await json('GET', '/api/blocks')).body.blocks.filter((b) => b.offered && b.example);
    assert.equal(rows.length, 32);
    let rev = 0;
    for (const b of rows) {
      const s = { id: 's1', title: b.example.title, flow: b.id, args: b.example.args, executor: b.example.executor, ...(b.example.touches ? { touches: b.example.touches } : {}) };
      assert.equal((await put({ [b.id]: { enabled: false } }, rev)).status, 200, b.id);
      rev += 1;
      const r = await json('POST', '/api/plan/run', { body: { plan: plan([s]) } });
      assert.equal(r.status, 400, b.id);
      assert.ok(r.body.errors.some((x) => x.code === 'COCKPIT_BLOCK_DISABLED'), `${b.id}: ${JSON.stringify(r.body.errors.map((x) => x.code))}`);
    }
    assert.deepEqual(started, [], 'not one of them started anything');
  });
});

test('the setting takes effect at once and survives a restart (a second service over the same state directory)', async () => {
  const stateDir = makeTempDir('og407-state-');
  const root = makeProject();
  await withStack({ stateDir, root }, async ({ put }) => { assert.equal((await put({ validate: { enabled: false } }, 0)).status, 200); });
  await withStack({ stateDir, root }, async ({ json, started }) => {
    const r = await json('POST', '/api/plan/run', { body: { plan: plan([step({ flow: 'validate', args: {} })]) } });
    assert.equal(r.status, 400);
    assert.ok(r.body.errors.some((x) => x.code === 'COCKPIT_BLOCK_DISABLED'));
    assert.deepEqual(started, []);
  });
});

test('one project\'s settings never refuse another project\'s plan', async () => {
  const stateDir = makeTempDir('og407-state-');
  await withStack({ stateDir, root: makeProject() }, async ({ put }) => { await put({ 'create.unit': { enabled: false } }, 0); });
  await withStack({ stateDir, root: makeProject() }, async ({ json, started }) => {
    assert.equal((await json('POST', '/api/plan/run', { body: { plan: plan([createUnit()]) } })).status, 200);
    assert.equal(started.length, 1);
  });
});

test('fail closed: settings that cannot be read, or a reader that throws, refuse every plan by name until they are saved again', async () => {
  await withStack({}, async ({ json, put, started, root, stateDir }) => {
    const file = openBlockSettingsStore(root, { stateDir }).file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{broken');
    assert.match((await json('GET', '/api/blocks')).body.unreadable, /^unreadable:/, 'the catalogue says so, so the screen can offer a reset');
    const r = await json('POST', '/api/plan/run', { body: { plan: plan() } });
    assert.equal(r.status, 400);
    assert.ok(r.body.errors.some((x) => x.code === 'COCKPIT_BLOCK_SETTINGS_UNREADABLE' && /could not be read/.test(x.plain)));
    assert.deepEqual(started, []);
    assert.equal((await put({}, 0)).status, 200, 'saving replaces the damaged file');
    assert.equal((await json('POST', '/api/plan/run', { body: { plan: plan() } })).status, 200);
  });
  await withStack({ getBlockSettings: () => { throw new Error('disk gone'); } }, async ({ json, started }) => {
    const r = await json('POST', '/api/plan/run', { body: { plan: plan() } });
    assert.equal(r.status, 400);
    assert.ok(r.body.errors.some((x) => x.code === 'COCKPIT_BLOCK_SETTINGS_UNREADABLE'));
    assert.deepEqual(started, []);
  });
});

test('/api/plan/context marks a turned-off block, so the Plan screen can say so', async () => {
  await withStack({}, async ({ json, put }) => {
    await put({ sync: { enabled: false } }, 0);
    const flows = (await json('GET', '/api/plan/context')).body.flows;
    assert.deepEqual(flows.filter((f) => !f.enabled).map((f) => f.id), ['sync']);
  });
});
