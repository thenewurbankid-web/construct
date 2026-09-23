// #569 slice 2: the dev-server slot is per signed-in login. A starts X, B starts Y: each sees only its own status,
// gets its own port, stopping A's leaves B's running, and A signing out (stopForLogin) never touches B's.
import '../../../test-utils/workspaceRoot.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { updateSettings, getProjectDir } from './settings.mjs';
import { baseWorkspaceRoot, resetWorkspaceRootForTests, runInUserWorkspace } from './workspace.mjs';
import { createDevServerService } from './devServer.mjs';

const FIXTURE = `import http from 'node:http';
const port = Number(process.env.PORT);
const srv = http.createServer((q, r) => r.end('ok'));
srv.listen(port, '127.0.0.1', () => console.log('  Local:   http://localhost:' + port + '/'));
process.on('SIGTERM', () => srv.close(() => process.exit(0)));
`;

let tmp;
let base;
let saved;
let svc;
const as = (login, fn) => runInUserWorkspace(login, fn);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const until = async (fn, ms = 20_000) => {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
};
const mk = (login, name) => {
  const dir = path.join(base, login, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, scripts: { dev: 'node server.mjs' } }));
  fs.writeFileSync(path.join(dir, 'server.mjs'), FIXTURE);
  return fs.realpathSync.native(dir);
};
const running = (login) => until(async () => { const s = await as(login, () => svc.status()); return s.state === 'running' ? s : null; });

before(() => {
  tmp = makeTempDir('devsrv-users-');
  base = path.join(fs.realpathSync.native(tmp), 'ws');
  fs.mkdirSync(base);
  saved = process.env.CONSTRUCT_WORKSPACE_ROOT;
  process.env.CONSTRUCT_WORKSPACE_ROOT = base;
  resetWorkspaceRootForTests();
  base = baseWorkspaceRoot();
  svc = createDevServerService({ getProjectDir, portBase: 47900 });
});

after(async () => {
  await svc.stopAll();
  if (saved === undefined) delete process.env.CONSTRUCT_WORKSPACE_ROOT;
  else process.env.CONSTRUCT_WORKSPACE_ROOT = saved;
  resetWorkspaceRootForTests();
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('two users start at the same moment: distinct ports, each status is its own, stop is scoped', async () => {
  const x = mk('alice', 'x');
  const y = mk('bob', 'y');
  as('alice', () => updateSettings({ projectDir: x }));
  as('bob', () => updateSettings({ projectDir: y }));

  const [ra, rb] = await Promise.all([as('alice', () => svc.start()), as('bob', () => svc.start())]);
  assert.equal(ra.status, 202);
  assert.equal(rb.status, 202);
  const a = await running('alice');
  const b = await running('bob');
  assert.equal(a.root, x);
  assert.equal(b.root, y);
  assert.notEqual(a.port, b.port);
  assert.notEqual(a.pid, b.pid);

  // A repeat start by Alice is refused as already running (her slot), whatever Bob is doing.
  assert.equal((await as('alice', () => svc.start())).status, 409);

  await as('alice', () => svc.stop());
  assert.equal((await as('alice', () => svc.status())).state, 'not-running');
  await until(() => !alive(a.pid));
  assert.equal((await as('bob', () => svc.status())).state, 'running');
  assert.equal(alive(b.pid), true);
});

test('one login signing out stops only that login\'s dev servers', async () => {
  await as('alice', () => svc.start());
  const a = await running('alice');
  const b = await running('bob');
  await svc.stopForLogin('alice');
  await until(() => !alive(a.pid));
  assert.equal((await as('alice', () => svc.status())).state, 'not-running');
  assert.equal((await as('bob', () => svc.status())).state, 'running');
  assert.equal(alive(b.pid), true);
  await svc.stopForLogin('not a login!');
  assert.equal(alive(b.pid), true);
  await svc.stopForLogin('BOB');
  await until(() => !alive(b.pid));
});

test('status versions are per login, and no-session (auth off) is its own key', async () => {
  const va = (await as('alice', () => svc.status())).version;
  const vb = (await as('bob', () => svc.status())).version;
  assert.ok(va > 0 && vb > 0);
  const c = mk('carol', 'z');
  as('carol', () => updateSettings({ projectDir: c }));
  await as('carol', () => svc.start());
  await running('carol');
  assert.equal((await as('alice', () => svc.status())).version, va);
  assert.equal((await as('bob', () => svc.status())).version, vb);
  assert.equal(svc.status().state, 'not-running');
  await svc.stopForLogin('carol');
});
