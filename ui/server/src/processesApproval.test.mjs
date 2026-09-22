// #341 — the approval endpoints. The security properties come first: both routes sit behind the
// session gate, `by` is derived from the server-side session and can never be supplied by the
// request, `diffSha256` is echoed and never computed, there is no approve-all, and every refusal the
// core gate (#337) makes reaches the client with its reason and cannot be overridden.
import '../../../test-utils/workspaceRoot.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import express from 'express';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { botBranch } from '../../../packages/engine/botRunner.mjs';
import { createProcess, recordArtifact } from '../../../packages/engine/processModel.mjs';
import { SESSION_COOKIE, createAuth, resolveAuthConfig, signValue } from './auth.mjs';
import { createProcessesService } from './processesService.mjs';
import { createProcessesRouter } from './processesApi.mjs';
import { app as realApp, auth as realAuth } from './index.mjs';

const ORIGIN = 'http://localhost:3000';
const SECRET = 's'.repeat(48);
const ENV = { CONSTRUCT_AUTH: 'required', CONSTRUCT_AUTH_TEST_USER: 'e2e-user', CONSTRUCT_SESSION_SECRET: SECRET };
const cookie = (login = 'e2e-user') => `${SESSION_COOKIE}=${encodeURIComponent(signValue({ login, exp: Date.now() + 60_000 }, SECRET))}`;
const ID = ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false'];
const git = (cwd, ...args) => spawnSync('git', [...ID, ...args], { cwd, encoding: 'utf8' });

/**
 * A git project with a committed base, a bot branch holding `bot` (path -> content) and a process
 * record with one artifact per bot file. `declared` is the plan's touches (default: all of them).
 */
function seedProject(root, service, { base = { 'a.ts': 'old\n' }, bot = { 'a.ts': 'new\n', 'b.ts': 'fresh\n' }, declared, state = 'done', id = 'p1' } = {}) {
  git(root, 'init', '-q', '-b', 'main');
  for (const [p, c] of Object.entries({ 'README.md': 'user\n', ...base })) fs.writeFileSync(path.join(root, p), c);
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');
  const wt = path.join(makeTempDir('construct-appr-wt-'), 'wt');
  git(root, 'worktree', 'add', '-q', '-b', botBranch(id), wt, 'HEAD');
  const changes = [];
  for (const [p, c] of Object.entries(bot)) {
    fs.writeFileSync(path.join(wt, p), c);
    changes.push({ path: p, change: p in base ? 'modify' : 'create', before: p in base ? base[p] : null, after: c });
  }
  git(wt, 'add', '-A');
  git(wt, 'commit', '-q', '-m', 's1');
  git(root, 'worktree', 'remove', '--force', wt);
  const files = declared ?? changes.map((c) => ({ path: c.path, change: c.change }));
  const plan = { version: 1, ticket: { source: 'text', title: 'T' }, steps: [{ id: 's1', title: 'S', flow: 'create.unit', args: { layer: 'domain', name: 'X', feature: 'f' }, executor: 'deterministic', touches: { features: [], files } }] };
  let rec = createProcess(plan, { id, projectRoot: root });
  for (const c of changes) rec = recordArtifact(rec, { ...c, stepId: 's1' });
  rec = { ...rec, state, steps: rec.steps.map((s) => ({ ...s, status: state === 'running' ? 'running' : 'done' })) };
  service.store().save(rec);
  return rec;
}

async function withStack({ authOn = true, seed = {} } = {}, fn) {
  const projectDir = fs.realpathSync(makeTempDir('construct-appr-project-'));
  const stateDir = makeTempDir('construct-appr-state-');
  const service = createProcessesService({ getProjectDir: () => projectDir, stateDir, executeStep: async () => ({ ok: true, llm: null }) });
  const auth = createAuth(resolveAuthConfig(authOn ? ENV : {}, { host: '127.0.0.1', clientOrigin: ORIGIN }));
  const app = express();
  app.use(express.json());
  auth.mountRoutes(app);
  app.use('/api', auth.requireSession);
  app.use('/api/processes', createProcessesRouter(service));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const record = seedProject(projectDir, service, seed);
  const call = (method, p, { headers = {}, body } = {}) => fetch(`http://127.0.0.1:${port}${p}`, {
    method,
    headers: { origin: ORIGIN, ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const authed = { cookie: cookie() };
  const review = async (id = 'p1') => (await call('GET', `/api/processes/${id}/review`, { headers: authed })).json();
  const decide = (body, { id = 'p1', headers = authed } = {}) => call('POST', `/api/processes/${id}/decide`, { headers, body });
  const shaOf = async (p) => (await review()).artifacts.find((a) => a.path === p).diffSha256;
  try {
    await fn({ service, call, review, decide, shaOf, projectDir, authed, record });
  } finally {
    server.close();
    server.closeAllConnections?.();
  }
}

// --- security --------------------------------------------------------------

test('review and decide are refused with 401 when there is no session, and work with one', async () => {
  await withStack({}, async ({ call, review, shaOf, projectDir }) => {
    const sha = await shaOf('a.ts');
    assert.equal((await call('GET', '/api/processes/p1/review')).status, 401);
    assert.equal((await call('POST', '/api/processes/p1/decide', { body: { path: 'a.ts', verdict: 'approve', diffSha256: sha } })).status, 401);
    assert.equal(fs.readFileSync(path.join(projectDir, 'a.ts'), 'utf8'), 'old\n', 'a refused request writes nothing');
    assert.equal((await review()).ok, true);
  });
});

test('the real server registers the approval routes behind the session gate (the processes router follows it)', () => {
  const stack = realApp._router.stack;
  const gate = stack.findIndex((layer) => layer.handle === realAuth.requireSession);
  const processes = stack.findIndex((layer) => layer.handle?.stack && layer.regexp.test('/api/processes'));
  assert.ok(gate >= 0 && processes > gate);
  const routes = stack[processes].handle.stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0]} ${l.route.path}`);
  assert.ok(routes.includes('get /:id/review'));
  assert.ok(routes.includes('post /:id/decide'));
  assert.ok(!routes.some((r) => /bulk|all/i.test(r)), 'there is no bulk or approve-all route');
});

test('a GET on the decide path changes nothing and is not a route', async () => {
  await withStack({}, async ({ call, authed, projectDir, shaOf }) => {
    const sha = await shaOf('a.ts');
    const res = await call('GET', `/api/processes/p1/decide?path=a.ts&verdict=approve&diffSha256=${sha}`, { headers: authed });
    assert.equal(res.status, 404);
    assert.equal(fs.readFileSync(path.join(projectDir, 'a.ts'), 'utf8'), 'old\n');
  });
});

test('`by` is the signed session login; a `by` in the body, the query or a header is ignored', async () => {
  await withStack({}, async ({ call, decide, shaOf, service }) => {
    const sha = await shaOf('a.ts');
    const res = await call('POST', '/api/processes/p1/decide?by=query-forger', {
      headers: { cookie: cookie('real-owner'), by: 'header-forger', 'x-forwarded-user': 'header-forger', 'x-by': 'header-forger' },
      body: { path: 'a.ts', verdict: 'approve', diffSha256: sha, by: 'body-forger', session: { login: 'body-forger' } },
    });
    assert.equal(res.status, 200);
    const artifact = service.store().load('p1').artifacts.find((a) => a.path === 'a.ts');
    assert.equal(artifact.verdict.by, 'real-owner');
    assert.ok(!JSON.stringify(service.store().load('p1')).includes('forger'), 'no forged name reaches the record or its log');
    void decide;
  });
});

test('with authentication off on loopback, `by` is the fixed "local" and a supplied `by` is still ignored', async () => {
  await withStack({ authOn: false }, async ({ call, shaOf, service }) => {
    const sha = await shaOf('a.ts');
    const res = await call('POST', '/api/processes/p1/decide?by=q', { headers: { by: 'h' }, body: { path: 'a.ts', verdict: 'reject', by: 'body-forger', diffSha256: sha } });
    assert.equal(res.status, 200);
    assert.equal(service.store().load('p1').artifacts.find((a) => a.path === 'a.ts').verdict.by, 'local');
  });
});

test('approve applies exactly the reviewed bytes, records who and when, and reports the validation', async () => {
  await withStack({}, async ({ decide, shaOf, projectDir, review }) => {
    const res = await decide({ path: 'a.ts', verdict: 'approve', diffSha256: await shaOf('a.ts') });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.decided, true);
    assert.equal(body.results[0].applied, true);
    assert.ok(body.validation, 'the post-apply validation is returned');
    assert.equal(body.validation.autoReverted ?? false, false, 'nothing is ever auto-reverted');
    assert.equal(fs.readFileSync(path.join(projectDir, 'a.ts'), 'utf8'), 'new\n');
    assert.equal(fs.existsSync(path.join(projectDir, 'b.ts')), false, 'the other file is untouched: one decision, one file');
    const after = (await review()).artifacts.find((a) => a.path === 'a.ts');
    assert.equal(after.verdict.decision, 'approved');
    assert.equal(after.verdict.by, 'e2e-user');
    assert.ok(after.verdict.at);
  });
});

test('reject writes nothing to the tree and is recorded', async () => {
  await withStack({}, async ({ decide, projectDir, review }) => {
    const res = await decide({ path: 'a.ts', verdict: 'reject' });
    assert.equal(res.status, 200);
    assert.equal(fs.readFileSync(path.join(projectDir, 'a.ts'), 'utf8'), 'old\n');
    assert.equal((await review()).artifacts.find((a) => a.path === 'a.ts').verdict.decision, 'rejected');
  });
});

test('a stale diff hash is refused by the gate and surfaced; a missing one likewise; nothing is written', async () => {
  await withStack({}, async ({ decide, projectDir }) => {
    const stale = await decide({ path: 'a.ts', verdict: 'approve', diffSha256: 'f'.repeat(64) });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).refusals[0].code, 'DIFF_STALE');
    const missing = await decide({ path: 'a.ts', verdict: 'approve' });
    assert.equal(missing.status, 409);
    assert.equal((await missing.json()).refusals[0].code, 'DIFF_STALE', 'the server never defaults the hash to the current one');
    assert.equal(fs.readFileSync(path.join(projectDir, 'a.ts'), 'utf8'), 'old\n');
  });
});

test('an unknown or traversal process id is 404 on both endpoints', async () => {
  await withStack({}, async ({ call, decide, authed }) => {
    for (const id of ['nope', '..%2F..%2Fetc%2Fpasswd', '%2e%2e', 'p1%00', 'p1.json']) {
      assert.equal((await call('GET', `/api/processes/${id}/review`, { headers: authed })).status, 404, `review ${id}`);
      assert.equal((await decide({ path: 'a.ts', verdict: 'reject' }, { id })).status, 404, `decide ${id}`);
    }
  });
});

test('a path with `..`, or one that is not an artifact of the process, is refused and writes nothing', async () => {
  await withStack({}, async ({ decide, projectDir, service }) => {
    for (const p of ['../evil.ts', 'sub/../a.ts', '/etc/passwd', 'README.md', 'nope.ts']) {
      const res = await decide({ path: p, verdict: 'approve', diffSha256: 'a'.repeat(64) });
      assert.equal(res.status, 409, p);
      assert.equal((await res.json()).decided, false, p);
    }
    assert.equal(fs.readFileSync(path.join(projectDir, 'README.md'), 'utf8'), 'user\n');
    assert.ok(service.store().load('p1').artifacts.every((a) => a.approved === null), 'nothing got a verdict');
  });
});

test('an artifact recorded with a `..` path is refused at review and can never be approved', async () => {
  await withStack({ seed: { bot: { 'a.ts': 'new\n' }, declared: [{ path: 'a.ts', change: 'modify' }, { path: '../evil.ts', change: 'create' }] } }, async ({ service, decide, review }) => {
    service.store().save(recordArtifact(service.store().load('p1'), { path: '../evil.ts', change: 'create', before: null, after: 'x', stepId: 's1' }));
    const evil = (await review()).artifacts.find((a) => a.path === '../evil.ts');
    assert.equal(evil.applicable, false);
    assert.equal(evil.refusals[0].code, 'PATH_INVALID');
    const res = await decide({ path: '../evil.ts', verdict: 'approve', diffSha256: evil.diffSha256 ?? 'x' });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).refusals[0].code, 'PATH_INVALID');
  });
});

test('a file outside the plan\'s declared touches is refused with its reason and cannot be approved', async () => {
  await withStack({ seed: { declared: [{ path: 'a.ts', change: 'modify' }] } }, async ({ review, decide, projectDir }) => {
    const b = (await review()).artifacts.find((a) => a.path === 'b.ts');
    assert.equal(b.applicable, false);
    assert.equal(b.refusals[0].code, 'OUTSIDE_TOUCHES');
    const res = await decide({ path: 'b.ts', verdict: 'approve', diffSha256: b.diffSha256 });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).refusals[0].code, 'OUTSIDE_TOUCHES');
    assert.equal(fs.existsSync(path.join(projectDir, 'b.ts')), false);
  });
});

test('a decision while the process is running is refused', async () => {
  await withStack({ seed: { state: 'running' } }, async ({ decide, shaOf, projectDir }) => {
    const res = await decide({ path: 'a.ts', verdict: 'approve', diffSha256: await shaOf('a.ts') });
    assert.equal(res.status, 409);
    assert.equal((await res.json()).code, 'PROCESS_ACTIVE');
    assert.equal(fs.readFileSync(path.join(projectDir, 'a.ts'), 'utf8'), 'old\n');
  });
});

test('there is no approve-all: a decisions array, a missing path or a bad verdict is a 400 and writes nothing', async () => {
  await withStack({}, async ({ decide, projectDir, shaOf }) => {
    const sha = await shaOf('a.ts');
    for (const body of [
      { decisions: [{ path: 'a.ts', verdict: 'approve', diffSha256: sha }, { path: 'b.ts', verdict: 'approve', diffSha256: await shaOf('b.ts') }] },
      { verdict: 'approve', all: true },
      { path: 'a.ts', verdict: 'approve-all' },
      { path: ['a.ts', 'b.ts'], verdict: 'approve' },
    ]) {
      assert.equal((await decide(body)).status, 400, JSON.stringify(body).slice(0, 60));
    }
    assert.equal(fs.readFileSync(path.join(projectDir, 'a.ts'), 'utf8'), 'old\n');
    assert.equal(fs.existsSync(path.join(projectDir, 'b.ts')), false);
  });
});

test('a verdict is final: a second decision on the same file is refused', async () => {
  await withStack({}, async ({ decide, shaOf }) => {
    assert.equal((await decide({ path: 'a.ts', verdict: 'reject' })).status, 200);
    const again = await decide({ path: 'a.ts', verdict: 'approve', diffSha256: await shaOf('a.ts') });
    assert.equal(again.status, 409);
    assert.equal((await again.json()).refusals[0].code, 'ALREADY_DECIDED');
  });
});

test('uncommitted user edits make the artifact refused (DIRTY) and the approval is refused', async () => {
  await withStack({}, async ({ decide, review, projectDir }) => {
    fs.writeFileSync(path.join(projectDir, 'a.ts'), 'my own edit\n');
    const a = (await review()).artifacts.find((x) => x.path === 'a.ts');
    assert.equal(a.applicable, false);
    assert.ok(a.refusals.some((r) => r.code === 'DIRTY'));
    const res = await decide({ path: 'a.ts', verdict: 'approve', diffSha256: a.diffSha256 });
    assert.equal(res.status, 409);
    assert.equal(fs.readFileSync(path.join(projectDir, 'a.ts'), 'utf8'), 'my own edit\n');
  });
});
