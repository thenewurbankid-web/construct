// #569 slice 1: the open project and the remembered project are per signed-in login. Two users in one server process
// never see or change each other's; the persisted last-project file is one per login; auth-off keeps its own key.
import '../../../test-utils/workspaceRoot.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { getSettings, updateSettings, getProjectDir, lastProjectFilePath } from './settings.mjs';
import { WorkspaceError, baseWorkspaceRoot, resetWorkspaceRootForTests, runInUserWorkspace, currentLogin } from './workspace.mjs';

let tmp;
let base;
let saved;

before(() => {
  tmp = makeTempDir('construct-settings-users-');
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
const mk = (login, name) => {
  const dir = path.join(base, login.toLowerCase(), name);
  fs.mkdirSync(dir, { recursive: true });
  return fs.realpathSync.native(dir);
};

test('two users open different projects; neither sees or changes the other\'s', () => {
  const a = mk('alice', 'app');
  const b = mk('bob', 'site');
  as('alice', () => updateSettings({ projectDir: a }));
  as('bob', () => updateSettings({ projectDir: b }));
  assert.equal(as('alice', () => getProjectDir()), a);
  assert.equal(as('bob', () => getProjectDir()), b);
  assert.equal(as('alice', () => getSettings().projectDir), a);
  assert.equal(as('bob', () => getSettings().projectDir), b);
});

test('closing one user\'s project leaves the other\'s open', () => {
  const a = mk('carol', 'app');
  const b = mk('dave', 'app');
  as('carol', () => updateSettings({ projectDir: a }));
  as('dave', () => updateSettings({ projectDir: b }));
  as('carol', () => updateSettings({ closeProject: true }));
  assert.equal(as('carol', () => getProjectDir()), null);
  assert.equal(as('dave', () => getProjectDir()), b);
});

test('a user cannot open another user\'s directory (workspace scope), and the failure changes nothing', () => {
  const a = mk('erin', 'app');
  const other = mk('frank', 'app');
  as('erin', () => updateSettings({ projectDir: a }));
  assert.throws(() => as('erin', () => updateSettings({ projectDir: other })), (e) => e instanceof WorkspaceError);
  assert.equal(as('erin', () => getProjectDir()), a);
});

test('login case does not split state: Alice and alice are one user', () => {
  const g = mk('gina', 'app');
  as('Gina', () => updateSettings({ projectDir: g }));
  assert.equal(as('gina', () => getProjectDir()), g);
});

test('the remembered last project is per user, persisted in one file per login', () => {
  const h1 = mk('hank', 'one');
  const i1 = mk('ivy', 'one');
  as('hank', () => updateSettings({ projectDir: h1 }));
  as('ivy', () => updateSettings({ projectDir: i1 }));
  as('hank', () => updateSettings({ closeProject: true }));
  assert.equal(as('hank', () => getSettings().lastProject), h1);
  assert.equal(as('ivy', () => getSettings().lastProject), null, 'ivy still has hers open, and hank\'s is not hers');
  assert.equal(JSON.parse(fs.readFileSync(lastProjectFilePath('hank'), 'utf8')).projectDir, h1);
  assert.equal(JSON.parse(fs.readFileSync(lastProjectFilePath('ivy'), 'utf8')).projectDir, i1);
  assert.notEqual(lastProjectFilePath('hank'), lastProjectFilePath('ivy'));
});

test('with no session (auth off) the state is its own key and keeps the original file name', () => {
  assert.equal(currentLogin(), '');
  assert.equal(path.basename(lastProjectFilePath('')), 'last-project.json');
  assert.equal(path.basename(lastProjectFilePath('Jo')), 'last-project.jo.json');
  const j = mk('jo', 'app');
  as('jo', () => updateSettings({ projectDir: j }));
  // The unscoped key is untouched by a signed-in user's choice (and jo's dir is inside the base, but not opened here).
  assert.equal(getProjectDir(), null);
});

test('an invalid login cannot select a state file', () => {
  for (const bad of ['../x', 'a/b', 'a.b', '..', ' ', 'x'.repeat(65), null, undefined, 5]) {
    assert.throws(() => lastProjectFilePath(bad), (e) => e instanceof WorkspaceError && e.status === 403, String(bad));
  }
});
