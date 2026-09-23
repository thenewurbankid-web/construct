// #569 slice 3: the LLM provider choices (per-action Mechanical|AI / provider / model / mock|real, i.e.
// `shared.llmProviders` as it used to be) are per signed-in login, the same pattern slice 1 used for the open
// project and slice 2 for the dev-server slot. Two users in one server process never see or change each other's
// provider choices; signing one out leaves the other's untouched; no session / auth off keeps behaving exactly
// as the old single shared object did (key '').
import '../../../test-utils/workspaceRoot.mjs';
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { getSettings, updateSettings } from './settings.mjs';
import { baseWorkspaceRoot, resetWorkspaceRootForTests, runInUserWorkspace, currentLogin } from './workspace.mjs';

let tmp;
let saved;

before(() => {
  tmp = makeTempDir('construct-llm-providers-users-');
  const base = path.join(fs.realpathSync.native(tmp), 'ws');
  fs.mkdirSync(base);
  saved = process.env.CONSTRUCT_WORKSPACE_ROOT;
  process.env.CONSTRUCT_WORKSPACE_ROOT = base;
  resetWorkspaceRootForTests();
  baseWorkspaceRoot();
});

after(() => {
  if (saved === undefined) delete process.env.CONSTRUCT_WORKSPACE_ROOT;
  else process.env.CONSTRUCT_WORKSPACE_ROOT = saved;
  resetWorkspaceRootForTests();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const as = (login, fn) => runInUserWorkspace(login, fn);

test('two users set different providers for the same capability; neither sees the other\'s', () => {
  as('alice', () => updateSettings({ llmProviders: { importFill: 'claude' } }));
  as('bob', () => updateSettings({ llmProviders: { importFill: 'ollama' } }));
  assert.equal(as('alice', () => getSettings().llmProviders.importFill), 'claude');
  assert.equal(as('bob', () => getSettings().llmProviders.importFill), 'ollama');
});

test('signing one user out (a fresh call under their login) leaves the other user\'s choice alone', () => {
  as('carol', () => updateSettings({ llmProviders: { createFill: 'ollama' } }));
  as('dave', () => updateSettings({ llmProviders: { createFill: 'claude' } }));
  // "Sign-out" of carol: nothing more happens under her login; dave's state must be untouched by it.
  assert.equal(as('dave', () => getSettings().llmProviders.createFill), 'claude');
  // carol's own choice is still there when she's back too (in-memory state isn't destroyed by "signing out").
  assert.equal(as('carol', () => getSettings().llmProviders.createFill), 'ollama');
});

test('a single-user / no-session setup (auth off) behaves exactly as before: one shared key, \'\'', () => {
  assert.equal(currentLogin(), '');
  const before1 = getSettings().llmProviders.importFill;
  updateSettings({ llmProviders: { importFill: 'ollama' } });
  assert.equal(getSettings().llmProviders.importFill, 'ollama');
  // A signed-in login's choice never leaks into the '' key.
  as('erin', () => updateSettings({ llmProviders: { importFill: 'claude' } }));
  assert.equal(getSettings().llmProviders.importFill, 'ollama');
  assert.notEqual(before1, undefined);
});

test('login case does not split provider state: Frank and frank are one user', () => {
  as('Frank', () => updateSettings({ llmProviders: { planAnalysis: 'claude' } }));
  assert.equal(as('frank', () => getSettings().llmProviders.planAnalysis), 'claude');
});

test('the legacy single-field llmProvider still only ever touches importFill, per login', () => {
  as('gina', () => updateSettings({ llmProvider: 'ollama' }));
  const s = as('gina', () => getSettings());
  assert.equal(s.llmProviders.importFill, 'ollama');
  assert.equal(s.llmProvider, 'ollama');
  assert.notEqual(as('henry', () => getSettings().llmProviders.importFill), 'ollama');
});

test('planAnalysis still refuses ollama, per login, and leaves that login\'s state unchanged', () => {
  assert.throws(() => as('ivan', () => updateSettings({ llmProviders: { planAnalysis: 'ollama' } })), /planAnalysis/);
  const s = as('ivan', () => getSettings());
  assert.notEqual(s.llmProviders.planAnalysis, 'ollama');
});
