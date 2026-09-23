// #567: the per-user workspace scope and the hosted-mode root validation. (workspace.test.mjs covers the containment
// rules themselves; here the question is "whose directory is `workspaceRoot()` right now, and can anyone escape it".)
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import {
  MAX_LOGIN_LENGTH, WorkspaceError, baseWorkspaceRoot, contain, resetWorkspaceRootForTests, resolveWorkspaceRoot,
  runInUserWorkspace, userWorkspaceDir, userWorkspaceMiddleware, workspaceRoot,
} from './workspace.mjs';

let tmp;
let base; // the base root (real path)
let saved;

before(() => {
  tmp = makeTempDir('construct-wsuser-');
  base = fs.realpathSync.native(tmp);
  base = path.join(base, 'ws');
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

const refused = (fn) => assert.throws(fn, (e) => e instanceof WorkspaceError && e.status === 403 && e.code === 'OUTSIDE_WORKSPACE');

// Drive the real middleware with a fake request; `probe` runs inside the scope (and after an await).
async function asUser(session, probe) {
  let result;
  let status = null;
  const res = { status(s) { status = s; return this; }, json(b) { this.body = b; return this; } };
  await new Promise((resolve) => {
    userWorkspaceMiddleware({ session }, res, () => {
      Promise.resolve()
        .then(() => new Promise((r) => setImmediate(r)))
        .then(() => { result = probe(); })
        .then(resolve);
    });
    if (status !== null) resolve();
  });
  return { result, status, res };
}

test('auth off: no session leaves workspaceRoot() at the base root, unchanged', async () => {
  assert.equal(workspaceRoot(), base);
  const { result, status } = await asUser(null, () => workspaceRoot());
  assert.equal(result, base);
  assert.equal(status, null);
  assert.equal((await asUser(undefined, () => workspaceRoot())).result, base);
  assert.deepEqual(fs.readdirSync(base), [], 'no per-user directory is created without a session');
});

test('a session scopes workspaceRoot() to <base>/<login> (lowercased, created 0700, survives an await)', async () => {
  const { result } = await asUser({ login: 'Alice-Dev' }, () => workspaceRoot());
  assert.equal(result, path.join(base, 'alice-dev'));
  assert.ok(fs.statSync(result).isDirectory());
  assert.equal(fs.statSync(result).mode & 0o777, 0o700);
  assert.equal(workspaceRoot(), base, 'the scope ends with the request');
});

test('user A cannot reach user B\'s directory, and the refusal is the same 403 as any outside path', () => {
  const bDir = runInUserWorkspace('bob', () => workspaceRoot());
  fs.writeFileSync(path.join(bDir, 'secret.txt'), 'b');
  const aRefuse = (p) => runInUserWorkspace('alice', () => {
    assert.equal(workspaceRoot(), path.join(base, 'alice'));
    return assert.throws(() => contain(workspaceRoot(), p), (e) => e instanceof WorkspaceError && e.status === 403 && e.code === 'OUTSIDE_WORKSPACE');
  });
  aRefuse(bDir); // absolute path to B's directory
  aRefuse(path.join(bDir, 'secret.txt')); // an existing file of B's
  aRefuse('../bob'); // relative climb to B's directory
  aRefuse(path.join(base, 'bob', 'does-not-exist')); // a path in B's directory that does not exist: same answer
  aRefuse(base); // the base root itself
});

test('logins that are not one safe path segment are refused with 403 (and touch nothing)', () => {
  const before = fs.readdirSync(base).sort();
  for (const bad of ['..', '.', 'a/b', 'a\\b', '', ' ', 'a\0b', '.hidden', 'a.b', '../x', 'x'.repeat(MAX_LOGIN_LENGTH + 1), 'ünï', null, undefined, 42, {}]) {
    refused(() => userWorkspaceDir(base, bad));
    refused(() => runInUserWorkspace(bad, () => 'ran'));
  }
  assert.deepEqual(fs.readdirSync(base).sort(), before);
  assert.equal(userWorkspaceDir(base, 'x'.repeat(MAX_LOGIN_LENGTH)), path.join(base, 'x'.repeat(MAX_LOGIN_LENGTH)));
});

test('the middleware answers 403 for a bad login and never calls next', async () => {
  for (const login of ['..', 'a/b', '', 'y'.repeat(500)]) {
    let called = false;
    const res = { status(s) { this.code = s; return this; }, json(b) { this.body = b; return this; } };
    userWorkspaceMiddleware({ session: { login } }, res, () => { called = true; });
    assert.equal(called, false);
    assert.equal(res.code, 403);
    assert.equal(res.body.code, 'OUTSIDE_WORKSPACE');
  }
});

test('a symlink out of the user directory is refused, and a user directory that is itself a symlink out is refused', () => {
  const outside = path.join(tmp, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'x.txt'), 'x');
  const dir = runInUserWorkspace('carol', () => workspaceRoot());
  fs.symlinkSync(outside, path.join(dir, 'escape'));
  runInUserWorkspace('carol', () => {
    assert.throws(() => contain(workspaceRoot(), 'escape'), (e) => e instanceof WorkspaceError && e.status === 403);
    assert.throws(() => contain(workspaceRoot(), 'escape/x.txt'), (e) => e instanceof WorkspaceError && e.status === 403);
    assert.throws(() => contain(workspaceRoot(), 'escape/new.txt', { mustExist: false }), (e) => e instanceof WorkspaceError && e.status === 403);
  });
  // <base>/mallory -> outside
  fs.symlinkSync(outside, path.join(base, 'mallory'));
  refused(() => userWorkspaceDir(base, 'mallory'));
  // <base>/nested-link -> another user's directory stays inside the base but is still someone else's: allowed by the
  // base check only when it resolves to a real subdirectory; here it resolves to carol's, which the DevOps owns.
  // A login whose directory is a symlink to the base itself is refused.
  fs.symlinkSync(base, path.join(base, 'rootlink'));
  refused(() => userWorkspaceDir(base, 'rootlink'));
});

test('the per-user directory is created once and reused', () => {
  const a = userWorkspaceDir(base, 'dave');
  fs.writeFileSync(path.join(a, 'keep.txt'), 'k');
  assert.equal(userWorkspaceDir(base, 'DAVE'), a);
  assert.ok(fs.existsSync(path.join(a, 'keep.txt')));
});

// ---- hosted-mode startup validation ----------------------------------------------------------------------------
test('with auth required the root must be set: no $HOME/workspace default', () => {
  const home = path.join(tmp, 'home');
  assert.throws(() => resolveWorkspaceRoot({}, { home, authRequired: true }), /CONSTRUCT_WORKSPACE_ROOT must be set/);
  assert.throws(() => resolveWorkspaceRoot({ CONSTRUCT_WORKSPACE_ROOT: '   ' }, { home, authRequired: true }), /must be set/);
  assert.equal(fs.existsSync(path.join(home, 'workspace')), false);
  // auth off keeps the default
  assert.equal(resolveWorkspaceRoot({}, { home }), fs.realpathSync.native(path.join(home, 'workspace')));
});

test('with auth required the root must be absolute and not the filesystem root', () => {
  assert.throws(() => resolveWorkspaceRoot({ CONSTRUCT_WORKSPACE_ROOT: 'relative/ws' }, { authRequired: true }), /absolute/);
  assert.throws(() => resolveWorkspaceRoot({ CONSTRUCT_WORKSPACE_ROOT: '/' }, { authRequired: true }), /filesystem root/);
});

test('with auth required a root inside (or containing) the checkout or cwd is refused, before anything is created', () => {
  const checkout = path.join(tmp, 'checkout');
  const cwd = path.join(tmp, 'elsewhere', 'server');
  fs.mkdirSync(path.join(checkout, 'ui'), { recursive: true });
  fs.mkdirSync(cwd, { recursive: true });
  const opts = { authRequired: true, checkout, cwd };
  const inside = path.join(checkout, 'ui', 'workspace');
  assert.throws(() => resolveWorkspaceRoot({ CONSTRUCT_WORKSPACE_ROOT: inside }, opts), /overlaps the Construct checkout/);
  assert.equal(fs.existsSync(inside), false, 'refused before mkdir');
  assert.throws(() => resolveWorkspaceRoot({ CONSTRUCT_WORKSPACE_ROOT: checkout }, opts), /overlaps the Construct checkout/);
  assert.throws(() => resolveWorkspaceRoot({ CONSTRUCT_WORKSPACE_ROOT: path.join(cwd, 'ws') }, opts), /overlaps the server working directory/);
  assert.throws(() => resolveWorkspaceRoot({ CONSTRUCT_WORKSPACE_ROOT: tmp }, opts), /overlaps/, 'a root that contains the checkout');
  // a symlink spelling of a path inside the checkout is judged by its real path
  const alias = path.join(tmp, 'alias');
  fs.symlinkSync(path.join(checkout, 'ui'), alias);
  assert.throws(() => resolveWorkspaceRoot({ CONSTRUCT_WORKSPACE_ROOT: alias }, opts), /overlaps the Construct checkout/);
  // a sibling that merely shares a name prefix is fine
  const ok = path.join(tmp, 'checkout-workspaces');
  assert.equal(resolveWorkspaceRoot({ CONSTRUCT_WORKSPACE_ROOT: ok }, opts), fs.realpathSync.native(ok));
});

test('the real checkout and cwd are refused by default when auth is required', () => {
  assert.throws(() => resolveWorkspaceRoot({ CONSTRUCT_WORKSPACE_ROOT: path.join(process.cwd(), 'ws-x') }, { authRequired: true }), /overlaps/);
  assert.throws(() => resolveWorkspaceRoot({ CONSTRUCT_WORKSPACE_ROOT: path.resolve(import.meta.dirname, '..', '..', '..', 'ws-x') }, { authRequired: true }), /overlaps the Construct checkout/);
});

test('auth off: a root inside the checkout is still accepted (behaviour unchanged)', () => {
  const inside = path.join(tmp, 'ok-off');
  assert.equal(resolveWorkspaceRoot({ CONSTRUCT_WORKSPACE_ROOT: inside }, { checkout: tmp, cwd: tmp }), fs.realpathSync.native(inside));
});
