// Per-capability LLM routing (#100/Epic 6.4) — settings.mjs's own state is
// module-level (not reset between tests), so every test here re-sets the
// fields it cares about (and restores projectDir) rather than assuming a
// fresh module each time; Node's test runner loads this module once.
import '../../../test-utils/workspaceRoot.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getSettings, updateSettings, getProjectDir, preloadProject } from './settings.mjs';
import { WorkspaceError, workspaceRoot } from './workspace.mjs';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import { PROVIDERS } from '../../../src/llm.mjs';

test('getSettings returns a per-capability llmProviders map defaulting every capability to the same provider', () => {
  const settings = getSettings();
  assert.ok(settings.llmProviders);
  assert.equal(typeof settings.llmProviders.importFill, 'string');
  assert.equal(typeof settings.llmProviders.createFill, 'string');
  assert.equal(typeof settings.llmProviders.planAnalysis, 'string');
});

test('getSettings never lists ollama among planAnalysis\'s available providers, even though it is a real provider', () => {
  const settings = getSettings();
  assert.ok(settings.availableProviders.includes('claude'));
  // This assertion is only meaningful once #98's ollama provider exists;
  // guard so this test still passes (harmlessly) if PROVIDERS ever loses it.
  if (settings.availableProviders.includes('ollama')) {
    assert.equal(settings.availableProvidersByCapability.planAnalysis.includes('ollama'), false);
  }
  assert.deepEqual(
    settings.availableProvidersByCapability.importFill.sort(),
    settings.availableProviders.slice().sort(),
  );
  assert.deepEqual(
    settings.availableProvidersByCapability.createFill.sort(),
    settings.availableProviders.slice().sort(),
  );
});

test('updateSettings sets one capability at a time without disturbing the others', () => {
  updateSettings({ llmProviders: { importFill: 'claude' } });
  const before = getSettings().llmProviders;
  updateSettings({ llmProviders: { createFill: 'claude' } });
  const after = getSettings().llmProviders;
  assert.equal(after.importFill, before.importFill);
  assert.equal(after.createFill, 'claude');
});

test('updateSettings throws on an unknown provider for any capability, and does not apply it', () => {
  const before = getSettings().llmProviders.importFill;
  assert.throws(() => updateSettings({ llmProviders: { importFill: 'gpt-nope' } }), /Unknown LLM provider "gpt-nope"/);
  assert.equal(getSettings().llmProviders.importFill, before);
});

test('updateSettings HARD-REJECTS ollama for planAnalysis — the #96 guardrail — even though ollama is a valid provider elsewhere', { skip: !PROVIDERS.ollama }, () => {
  const before = getSettings().llmProviders.planAnalysis;
  assert.throws(
    () => updateSettings({ llmProviders: { planAnalysis: 'ollama' } }),
    /planAnalysis.*never delegated to a local model/s,
  );
  assert.equal(getSettings().llmProviders.planAnalysis, before, 'must not have been applied');
});

test('updateSettings accepts ollama for importFill and createFill (only planAnalysis is restricted)', { skip: !PROVIDERS.ollama }, () => {
  updateSettings({ llmProviders: { importFill: 'ollama' } });
  assert.equal(getSettings().llmProviders.importFill, 'ollama');
  updateSettings({ llmProviders: { createFill: 'ollama' } });
  assert.equal(getSettings().llmProviders.createFill, 'ollama');
  // Restore for any later test relying on defaults.
  updateSettings({ llmProviders: { importFill: 'claude', createFill: 'claude' } });
});

test('#365: the server starts with NO project open (never process.cwd()), and no project is offered to reopen yet', () => {
  const s = getSettings();
  assert.equal(s.projectDir, null);
  assert.notEqual(s.projectDir, process.cwd());
  assert.equal(s.projectRelative, null);
  assert.equal(s.lastProject, null);
  assert.equal(s.workspaceRoot, workspaceRoot());
});

test('#365: updateSettings applies a projectDir inside the workspace and refuses everything else, leaving state unchanged', () => {
  const dir = makeTempDir('settings-ws-');
  const inside = path.join(dir, 'proj');
  fs.mkdirSync(inside);
  const result = updateSettings({ projectDir: inside });
  assert.equal(result.projectDir, inside);
  assert.equal(result.projectRelative, path.relative(workspaceRoot(), inside));
  for (const bad of ['/definitely/not/a/real/path/xyz', '/', '/etc', path.join(workspaceRoot(), '..'), `${inside}\0`, path.join(inside, 'nope')]) {
    assert.throws(() => updateSettings({ projectDir: bad }), (e) => e instanceof WorkspaceError, bad);
    assert.equal(getSettings().projectDir, inside, `unchanged after refusing ${JSON.stringify(bad)}`);
  }
  fs.symlinkSync('/etc', path.join(dir, 'escape'));
  assert.throws(() => updateSettings({ projectDir: path.join(dir, 'escape') }), (e) => e.code === 'OUTSIDE_WORKSPACE');
  assert.equal(getSettings().projectDir, inside);
});

test('#365: a bad provider in the same request does not switch the project', () => {
  const before = getSettings().projectDir;
  const other = makeTempDir('settings-ws-other-');
  assert.throws(() => updateSettings({ projectDir: other, llmProviders: { importFill: 'gpt-nope' } }), /Unknown LLM provider/);
  assert.equal(getSettings().projectDir, before);
});

test('#365: closeProject closes it, and the closed project is offered as lastProject (never auto-loaded)', () => {
  const dir = makeTempDir('settings-ws-close-');
  updateSettings({ projectDir: dir });
  const closed = updateSettings({ closeProject: true });
  assert.equal(closed.projectDir, null);
  assert.equal(closed.lastProject, dir);
  assert.equal(getSettings().projectDir, null, 'still closed on the next read');
  const reopened = updateSettings({ projectDir: closed.lastProject });
  assert.equal(reopened.projectDir, dir);
  assert.equal(reopened.lastProject, null, 'the open project is not offered as "reopen"');
});

test('#365: a project replaced by a symlink out of the workspace stops being served on the next read (TOCTOU per use)', () => {
  const dir = makeTempDir('settings-ws-swap-');
  const proj = path.join(dir, 'proj');
  fs.mkdirSync(proj);
  updateSettings({ projectDir: proj });
  assert.equal(getSettings().projectDir, proj);
  fs.rmSync(proj, { recursive: true });
  fs.symlinkSync('/etc', proj);
  assert.equal(getProjectDir(), null);
  assert.equal(getSettings().projectDir, null);
});

test('#365: a last-project file that points outside the workspace is never offered (fresh process reads it)', async () => {
  const state = makeTempDir('settings-ws-state-');
  fs.writeFileSync(path.join(state, 'last-project.json'), JSON.stringify({ projectDir: '/etc' }));
  const script = `import('${new URL('./settings.mjs', import.meta.url).href}').then((m) => console.log(JSON.stringify(m.getSettings().lastProject)))`;
  const { execFileSync } = await import('node:child_process');
  const out = execFileSync(process.execPath, ['-e', script], { env: { ...process.env, CONSTRUCT_STATE_DIR: state }, encoding: 'utf8' });
  assert.equal(out.trim(), 'null');
});

test('#365: browseRoots can no longer be set by a client', () => {
  assert.throws(() => updateSettings({ browseRoots: ['/'] }), (e) => e.code === 'BROWSE_ROOTS_FIXED');
});

test('#365: preloadProject (harness) is contained exactly like a client choice', () => {
  assert.throws(() => preloadProject('/etc'), (e) => e instanceof WorkspaceError);
  const dir = makeTempDir('settings-ws-preload-');
  preloadProject(dir);
  assert.equal(getSettings().projectDir, dir);
  updateSettings({ closeProject: true });
});

test('updateSettings back-compat: a bare legacy { llmProvider } body sets importFill only, never planAnalysis/createFill', () => {
  updateSettings({ llmProviders: { createFill: 'claude', planAnalysis: 'claude' } });
  const before = getSettings().llmProviders;
  updateSettings({ llmProvider: 'claude' });
  const after = getSettings().llmProviders;
  assert.equal(after.importFill, 'claude');
  assert.equal(after.createFill, before.createFill);
  assert.equal(after.planAnalysis, before.planAnalysis);
});

test('getSettings exposes a legacy llmProvider field mirroring importFill, for any old reader', () => {
  updateSettings({ llmProviders: { importFill: 'claude' } });
  assert.equal(getSettings().llmProvider, getSettings().llmProviders.importFill);
});
