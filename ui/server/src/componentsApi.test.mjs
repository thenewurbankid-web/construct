// #431/#434 -- the Components API. Security first (session gate, foreign Origin, a client path must be a real
// component of THIS project, symlinks out refused, write only on the reviewed path), then behaviour.
import '../../../test-utils/workspaceRoot.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { SESSION_COOKIE, createAuth, resolveAuthConfig, signValue } from './auth.mjs';
import { createComponentsRouter, listComponents, MAX_EDIT_BYTES } from './componentsApi.mjs';
import { listAllPages } from './pagesEditor.mjs';
import { app as realApp, auth as realAuth } from './index.mjs';

const ORIGIN = 'http://localhost:3000';
const SECRET = 's'.repeat(48);
const ENV = { CONSTRUCT_AUTH: 'required', CONSTRUCT_AUTH_TEST_USER: 'e2e-user', CONSTRUCT_SESSION_SECRET: SECRET };
const cookie = () => `${SESSION_COOKIE}=${encodeURIComponent(signValue({ login: 'e2e-user', exp: Date.now() + 60_000 }, SECRET))}`;

const YML = 'version: 1\npreset: strict-nextjs\nproject:\n  framework: nextjs\nfeatures:\n  root: features\n';
const VIEW = `type ViewProps = { /** the total */ total: number; label?: string };
export function View({ total, label = 'x' }: ViewProps) {
  return <span>{label}{total}</span>;
}
`;

function project() {
  const dir = makeTempDir('construct-componentsapi-');
  fs.writeFileSync(path.join(dir, 'architecture.yml'), YML);
  const w = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  w('features/shop/components/View.tsx', VIEW);
  w('features/shop/components/Plain.tsx', 'export function Plain() {\n  return <i />;\n}\n');
  w('features/shop/pages/ShopPage.tsx', "import { View } from '../components/View';\nexport function ShopPage() {\n  return <View total={1} />;\n}\n");
  w('features/shop/domain/rules.ts', 'export const rule = 1;\n');
  w('features/cart/pages/CartPage.tsx', 'export function CartPage() {\n  return <div />;\n}\n');
  return dir;
}

async function withStack({ authOn = true, dir = project() } = {}, fn) {
  const auth = createAuth(resolveAuthConfig(authOn ? ENV : {}, { host: '127.0.0.1', clientOrigin: ORIGIN }));
  const app = express();
  app.use(express.json());
  auth.mountRoutes(app);
  app.use('/api', auth.requireSession);
  const saved = [];
  app.use('/api/components', createComponentsRouter({ clientOrigin: ORIGIN, afterSave: (root, rel) => { saved.push(rel); return { committed: false, status: 'test' }; }, getRoot: () => (dir ? { ok: true, root: dir } : { ok: false, error: 'No project.' }) }));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const call = (method, p, { body, headers = {}, raw } = {}) => fetch(`http://127.0.0.1:${port}${p}`, {
    method,
    headers: { origin: ORIGIN, cookie: cookie(), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers },
    ...(raw !== undefined ? { body: raw } : body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const json = async (method, p, opts) => { const r = await call(method, p, opts); return { status: r.status, body: await r.json() }; };
  try {
    await fn({ dir, call, json, saved });
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
}

const VIEW_PATH = 'features/shop/components/View.tsx';
const q = (p) => encodeURIComponent(p);

test('every /api/components route is refused with 401 when there is no session', async () => {
  await withStack({}, async ({ dir, call }) => {
    for (const [method, p, body] of [
      ['GET', '/api/components'],
      ['GET', `/api/components/describe?path=${q(VIEW_PATH)}`],
      ['GET', `/api/components/source?path=${q(VIEW_PATH)}`],
      ['POST', '/api/components/save', { path: VIEW_PATH, content: 'x', commit: true }],
    ]) {
      assert.equal((await call(method, p, { body, headers: { cookie: '' } })).status, 401, `${method} ${p}`);
    }
    assert.equal(fs.readFileSync(path.join(dir, VIEW_PATH), 'utf8'), VIEW);
    assert.equal((await call('GET', '/api/components')).status, 200);
  });
});

test('the real server registers /api/components AFTER the session gate', () => {
  const stack = realApp._router.stack;
  const gate = stack.findIndex((layer) => layer.handle === realAuth.requireSession);
  const router = stack.findIndex((layer) => layer.handle?.stack && layer.regexp.test('/api/components'));
  assert.ok(gate >= 0 && router > gate);
  const pagesAll = stack.findIndex((layer) => layer.route?.path === '/api/pages/all');
  assert.ok(pagesAll > gate, '/api/pages/all sits after the gate');
});

test('the list is every component of the project, with its feature', async () => {
  await withStack({}, async ({ json }) => {
    const { status, body } = await json('GET', '/api/components');
    assert.equal(status, 200);
    assert.deepEqual(body.components.map((c) => [c.name, c.feature, c.path]), [
      ['Plain', 'shop', 'features/shop/components/Plain.tsx'],
      ['View', 'shop', VIEW_PATH],
    ]);
  });
});

test('a path that is not in the list is refused, however it is spelled; nothing outside is read', async () => {
  await withStack({}, async ({ dir, json }) => {
    const outside = makeTempDir('construct-componentsapi-out-');
    fs.writeFileSync(path.join(outside, 'Secret.tsx'), 'export const S = () => <i/>;');
    fs.symlinkSync(path.join(outside, 'Secret.tsx'), path.join(dir, 'features/shop/components/Link.tsx'));
    for (const bad of ['../x.tsx', '/etc/passwd', 'features/shop/components/../domain/rules.ts', 'features/shop/domain/rules.ts', 'features/shop/pages/ShopPage.tsx', 'node_modules/x/index.tsx', 'features/shop/components/Nope.tsx', 'features/shop/components/Link.tsx', 'features/shop/components/View.tsx/', '', 'a\0b']) {
      for (const route of ['describe', 'source']) {
        const r = await json('GET', `/api/components/${route}?path=${q(bad)}`);
        assert.ok(r.status === 400 || r.status === 404, `${route} ${JSON.stringify(bad)} -> ${r.status}`);
        assert.equal(r.body.ok, false);
        assert.ok(!JSON.stringify(r.body).includes('Secret'));
      }
    }
    assert.equal((await json('GET', '/api/components/describe')).status, 400);
    assert.equal((await json('GET', '/api/components/source?path[]=a')).status, 400);
    assert.equal((await json('POST', '/api/components/save', { body: { path: '../x.tsx', content: 'x', commit: true } })).status, 404);
  });
});

test('describe returns the props of a component as data', async () => {
  await withStack({}, async ({ json }) => {
    const { status, body } = await json('GET', `/api/components/describe?path=${q(VIEW_PATH)}`);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.name, 'View');
    assert.equal(body.feature, 'shop');
    assert.deepEqual(body.components[0].props.map((p) => [p.name, p.type, p.required, p.default]), [['total', 'number', true, null], ['label', 'string', false, "'x'"]]);
    const plain = await json('GET', `/api/components/describe?path=${q('features/shop/components/Plain.tsx')}`);
    assert.equal(plain.body.ok, true);
    assert.equal(plain.body.components[0].props.length, 0);
  });
});

test('describe of a file that does not parse answers ok:false with a code, never a 500', async () => {
  const dir = project();
  fs.writeFileSync(path.join(dir, 'features/shop/components/Bad.tsx'), 'export function Bad( { return <i/>; \nconst = ;');
  await withStack({ dir }, async ({ json }) => {
    const { status, body } = await json('GET', `/api/components/describe?path=${q('features/shop/components/Bad.tsx')}`);
    assert.equal(status, 200);
    assert.equal(body.ok, false);
    assert.equal(body.code, 'PARSE_ERROR');
  });
});

test('source returns the plain text, its hash, whether it is editable and diagnostics', async () => {
  await withStack({}, async ({ json }) => {
    const { body } = await json('GET', `/api/components/source?path=${q(VIEW_PATH)}`);
    assert.equal(body.source, VIEW);
    assert.match(body.contentHash, /^[0-9a-f]{64}$/);
    assert.equal(body.editable, true);
    assert.ok(Array.isArray(body.diagnostics));
  });
});

test('save: a preview writes nothing; a commit needs the current hash, passes the architecture gate, writes, then commits-on-save', async () => {
  await withStack({}, async ({ dir, json, saved }) => {
    const abs = path.join(dir, VIEW_PATH);
    const src = (await json('GET', `/api/components/source?path=${q(VIEW_PATH)}`)).body;
    const next = VIEW.replace("label = 'x'", "label = 'y'");
    const preview = await json('POST', '/api/components/save', { body: { path: VIEW_PATH, content: next } });
    assert.equal(preview.status, 200);
    assert.equal(preview.body.before, VIEW);
    assert.equal(preview.body.after, next);
    assert.equal(fs.readFileSync(abs, 'utf8'), VIEW, 'a preview never writes');
    assert.equal(saved.length, 0);

    const stale = await json('POST', '/api/components/save', { body: { path: VIEW_PATH, content: next, commit: true, contentHash: 'nope' } });
    assert.equal(stale.status, 409);
    assert.equal(fs.readFileSync(abs, 'utf8'), VIEW);

    const ok = await json('POST', '/api/components/save', { body: { path: VIEW_PATH, content: next, commit: true, contentHash: src.contentHash } });
    assert.equal(ok.status, 200);
    assert.equal(ok.body.ok, true);
    assert.equal(fs.readFileSync(abs, 'utf8'), next);
    assert.deepEqual(saved, [VIEW_PATH]);
    assert.notEqual(ok.body.contentHash, src.contentHash);

    // The old hash no longer matches: the next commit is refused, not merged over.
    assert.equal((await json('POST', '/api/components/save', { body: { path: VIEW_PATH, content: VIEW, commit: true, contentHash: src.contentHash } })).status, 409);
  });
});

test('save: an edit that breaks an architecture rule is blocked (422) and the file is untouched', async () => {
  await withStack({}, async ({ dir, json, saved }) => {
    const abs = path.join(dir, VIEW_PATH);
    const src = (await json('GET', `/api/components/source?path=${q(VIEW_PATH)}`)).body;
    const bad = `import { fetchThing } from '../services/thing';\n${VIEW.replace('return <span>', 'fetchThing();\n  return <span>')}`;
    const r = await json('POST', '/api/components/save', { body: { path: VIEW_PATH, content: bad, commit: true, contentHash: src.contentHash } });
    assert.equal(r.status, 422);
    assert.equal(r.body.code, 'BLOCKED');
    assert.ok(r.body.violations.length > 0);
    assert.equal(fs.readFileSync(abs, 'utf8'), VIEW);
    assert.equal(saved.length, 0);
  });
});

test('save: bad content, oversize content, a foreign Origin and a non-JSON body are refused', async () => {
  await withStack({}, async ({ dir, json, call }) => {
    const src = (await json('GET', `/api/components/source?path=${q(VIEW_PATH)}`)).body;
    assert.equal((await json('POST', '/api/components/save', { body: { path: VIEW_PATH, commit: true, contentHash: src.contentHash } })).status, 400);
    assert.equal((await json('POST', '/api/components/save', { body: { path: VIEW_PATH, content: 5, commit: true, contentHash: src.contentHash } })).status, 400);
    assert.equal((await json('POST', '/api/components/save', { body: { path: VIEW_PATH, content: 'x'.repeat(MAX_EDIT_BYTES + 1), commit: true, contentHash: src.contentHash } })).status, 413);
    const foreign = await call('POST', '/api/components/save', { body: { path: VIEW_PATH, content: 'x', commit: true, contentHash: src.contentHash }, headers: { origin: 'https://evil.example' } });
    assert.equal(foreign.status, 403);
    const text = await call('POST', '/api/components/save', { raw: 'content=x', headers: { 'content-type': 'text/plain' } });
    assert.equal(text.status, 415);
    assert.equal(fs.readFileSync(path.join(dir, VIEW_PATH), 'utf8'), VIEW);
  });
});

test('listComponents and listAllPages read the real project', () => {
  const dir = project();
  assert.deepEqual(listComponents(dir).map((c) => c.name), ['Plain', 'View']);
  assert.deepEqual(listAllPages(dir), [{ feature: 'cart', file: 'CartPage.tsx' }, { feature: 'shop', file: 'ShopPage.tsx' }]);
});
