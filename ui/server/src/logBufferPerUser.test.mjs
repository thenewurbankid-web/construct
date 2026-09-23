// #569 slice 5: the Logs ring buffer is per signed-in login. A's command output (and the project paths in it) is
// invisible to B and B's to A; a dev server's lines land in the ring of the login that started it even though
// they arrive from child-process events outside any request; lines recorded with no login context go to '' and
// no signed-in user sees them; no session / auth off (key '') behaves exactly as the old single buffer did; the
// number of rings is capped so many sign-ins never grow memory without bound.
import '../../../test-utils/workspaceRoot.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { createLogBuffer, createLogRegistry, handleLogs, serverLog, MAX_ENTRIES, MAX_LOGINS } from './logBuffer.mjs';
import { runCapturing } from './commandRunner.mjs';
import { createDevServerService } from './devServer.mjs';
import { updateSettings, getProjectDir } from './settings.mjs';
import { baseWorkspaceRoot, resetWorkspaceRootForTests, runInUserWorkspace, currentLogin } from './workspace.mjs';

let tmp;
let base;
let saved;

before(() => {
  tmp = makeTempDir('construct-logs-users-');
  base = path.join(fs.realpathSync.native(tmp), 'ws');
  fs.mkdirSync(base);
  saved = process.env.CONSTRUCT_WORKSPACE_ROOT;
  process.env.CONSTRUCT_WORKSPACE_ROOT = base;
  resetWorkspaceRootForTests();
  base = baseWorkspaceRoot();
});

after(() => {
  if (saved === undefined) delete process.env.CONSTRUCT_WORKSPACE_ROOT;
  else process.env.CONSTRUCT_WORKSPACE_ROOT = saved;
  resetWorkspaceRootForTests();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const as = (login, fn) => runInUserWorkspace(login, fn);
const texts = (entries) => entries.map((e) => e.text);
const ORIGIN = 'http://localhost:3000';
const logsFor = (login) => as(login, () => handleLogs({}, { origin: ORIGIN, clientOrigin: ORIGIN }).body.entries);

test('A\'s command output is invisible to B, and B\'s to A; the route reads the caller\'s ring', async () => {
  await as('alice', () => runCapturing(async () => { console.log('alice: created /ws/alice/shop/features/cart'); }));
  await as('bob', () => runCapturing(async () => { console.log('bob: created /ws/bob/blog/features/posts'); }));

  const a = await as('alice', () => serverLog.read());
  const b = await as('bob', () => serverLog.read());
  assert.deepEqual(texts(a), ['alice: created /ws/alice/shop/features/cart']);
  assert.deepEqual(texts(b), ['bob: created /ws/bob/blog/features/posts']);
  assert.ok(!JSON.stringify(a).includes('bob'), 'nothing of bob in alice\'s ring');
  assert.ok(!JSON.stringify(b).includes('alice'), 'nothing of alice in bob\'s ring');

  // GET /api/logs, as the route calls it (inside the request's login context), sees the same split.
  assert.deepEqual(texts(await logsFor('alice')), ['alice: created /ws/alice/shop/features/cart']);
  assert.deepEqual(texts(await logsFor('bob')), ['bob: created /ws/bob/blog/features/posts']);

  // A failed command's error line stays with its owner too.
  await as('bob', () => runCapturing(async () => { throw new Error('bob only'); }));
  assert.ok(texts(await as('bob', () => serverLog.read())).some((t) => t.includes('failed: bob only')));
  assert.ok(!texts(await as('alice', () => serverLog.read())).some((t) => t.includes('bob only')));
});

test('a line recorded with no login context lands in \'\' and no signed-in user sees it', async () => {
  assert.equal(currentLogin(), '');
  const before = serverLog.read().length;
  serverLog.record('server', 'info', 'startup: listening on 4000');
  serverLog.record('auth', 'warn', 'sign-in refused for x');
  const mine = serverLog.read().slice(before);
  assert.deepEqual(texts(mine), ['startup: listening on 4000', 'sign-in refused for x']);
  for (const login of ['alice', 'bob', 'carol']) {
    const seen = texts(await as(login, () => serverLog.read()));
    assert.ok(!seen.includes('startup: listening on 4000'), `${login} does not see server-internal lines`);
    assert.ok(!seen.includes('sign-in refused for x'), `${login} does not see server-internal lines`);
  }
  // A login that never recorded anything reads an empty list, not somebody else's or the server's.
  assert.deepEqual(await as('carol', () => serverLog.read()), []);
});

test('no session / auth off (key \'\') behaves as the old single buffer: every line, increasing ids, `since` cursor', async () => {
  assert.equal(currentLogin(), '');
  const startAt = serverLog.read().length ? serverLog.read().at(-1).id : 0;
  await runCapturing(async () => { console.log('one'); console.log('two'); });
  serverLog.record('validate', 'info', 'three');
  const fresh = serverLog.read(startAt);
  assert.deepEqual(texts(fresh), ['one', 'two', 'three']);
  assert.ok(fresh.every((e, i) => i === 0 || e.id > fresh[i - 1].id), 'ids increase');
  const r = handleLogs({ since: String(fresh[0].id) }, { origin: ORIGIN, clientOrigin: ORIGIN });
  assert.deepEqual(texts(r.body.entries), ['two', 'three']);
  assert.equal(r.body.last, fresh[2].id);
  // A signed-in user's lines never appear on the no-session path either.
  await as('dave', () => runCapturing(async () => { console.log('dave only'); }));
  assert.ok(!texts(serverLog.read()).includes('dave only'));
  // A standalone ring (tests, injected seams) is untouched by all this: ids still start at 1.
  const alone = createLogBuffer();
  assert.equal(alone.record('s', 'info', 'x').id, 1);
});

test('a dev-server line, arriving from a child-process event outside any request, lands in its owner\'s ring', async () => {
  const children = [];
  const fakeSpawn = () => {
    const child = new EventEmitter();
    child.pid = 2 ** 30; // no such process: killGroup's process.kill(-pid) throws and falls back to child.kill
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => { setImmediate(() => child.emit('close', null, 'SIGTERM')); return true; };
    children.push(child);
    return child;
  };
  const svc = createDevServerService({ getProjectDir, spawn: fakeSpawn, portBase: 48100, startupTimeoutMs: 60_000 });
  try {
    const dir = path.join(base, 'erin', 'app');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'app', scripts: { dev: 'node server.mjs' } }));
    as('erin', () => updateSettings({ projectDir: fs.realpathSync.native(dir) }));
    const started = await as('erin', () => svc.start());
    assert.equal(started.status, 202);
    assert.equal(children.length, 1);

    // The child prints later, with no request in flight (no login context at all).
    assert.equal(currentLogin(), '');
    children[0].stdout.emit('data', Buffer.from('  Local: http://localhost:48100/ (erin secret banner)\n'));
    children[0].stderr.emit('data', Buffer.from('warning: erin only\n'));

    const erin = texts(await as('erin', () => serverLog.read()));
    assert.ok(erin.some((t) => /Starting npm run dev .* in app on port \d+/.test(t)), 'the start line is erin\'s');
    // record() only trimEnd()s, so the banner's leading indent survives verbatim.
    assert.ok(erin.includes('  Local: http://localhost:48100/ (erin secret banner)'));
    assert.ok(erin.includes('warning: erin only'));
    for (const other of ['', 'alice', 'bob', 'frank']) {
      const seen = texts(await (other === '' ? Promise.resolve(serverLog.read()) : as(other, () => serverLog.read())));
      assert.ok(!seen.some((t) => t.includes('erin')), `${JSON.stringify(other)} sees none of erin's dev-server lines`);
    }

    await as('erin', () => svc.stop());
    assert.ok(texts(await as('erin', () => serverLog.read())).includes('Dev server stopped.'));
    assert.ok(!texts(serverLog.read()).includes('Dev server stopped.'));
  } finally {
    await svc.stopAll();
  }
});

test('the registry keeps at most MAX_LOGINS rings, drops the least recently used (never \'\'), ids keep increasing', () => {
  assert.equal(MAX_LOGINS, 32);
  let who = '';
  const reg = createLogRegistry({ maxLogins: 3, login: () => who });
  reg.record('s', 'info', 'server line'); // '' (no context)
  for (const login of ['a', 'b', 'c']) reg.record('s', 'info', `${login} 1`, 1, login);
  assert.deepEqual(reg.logins(), ['', 'b', 'c'], 'four would exceed the cap: the oldest non-\'\' ring (a) was dropped');
  assert.deepEqual(reg.read(0, 'a'), []);
  assert.deepEqual(reg.read(0, '').map((e) => e.text), ['server line'], '\'\' survives although it is the oldest');

  // Reading refreshes recency: an open Logs tab that keeps polling is not dropped under its user.
  reg.read(0, 'b');
  reg.record('s', 'info', 'd 1', 1, 'd');
  assert.deepEqual(reg.logins(), ['', 'b', 'd']);
  assert.deepEqual(reg.read(0, 'c'), []);

  // A dropped login comes back with a fresh ring whose ids continue the process-wide sequence, so a `since`
  // cursor the client already holds never hides new lines.
  const lastSeen = reg.read(0, 'd').at(-1).id;
  const back = reg.record('s', 'info', 'a again', 1, 'a');
  assert.ok(back.id > lastSeen);
  assert.deepEqual(reg.read(lastSeen, 'a').map((e) => e.text), ['a again']);
  assert.deepEqual(reg.logins(), ['', 'd', 'a'], 'b, untouched since d arrived, made room for a');

  // The default login (the current request) is what record/read/clear use when no login is passed.
  who = 'a';
  reg.record('s', 'info', 'a 2');
  assert.deepEqual(reg.read().map((e) => e.text), ['a again', 'a 2']);
  reg.clear();
  assert.deepEqual(reg.read(), []);
  assert.deepEqual(reg.read(0, 'd').map((e) => e.text), ['d 1'], 'clear() touched only a');
  // A non-string login (a bug upstream) is treated as no context, never as somebody's ring.
  who = '';
  reg.record('s', 'info', 'odd', 1, undefined);
  assert.ok(reg.read(0, '').map((e) => e.text).includes('odd'));
});

test('each ring is bounded on its own', () => {
  const reg = createLogRegistry({ max: 2, login: () => '' });
  for (let i = 1; i <= 3; i++) reg.record('s', 'info', `a${i}`, 1, 'a');
  reg.record('s', 'info', 'b1', 1, 'b');
  assert.deepEqual(reg.read(0, 'a').map((e) => e.text), ['a2', 'a3']);
  assert.deepEqual(reg.read(0, 'b').map((e) => e.text), ['b1']);
  assert.equal(MAX_ENTRIES, 500);
});
