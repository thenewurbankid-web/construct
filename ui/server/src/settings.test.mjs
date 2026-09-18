// Per-capability LLM routing (#100/Epic 6.4) — settings.mjs's own state is
// module-level (not reset between tests), so every test here re-sets the
// fields it cares about (and restores projectDir) rather than assuming a
// fresh module each time; Node's test runner loads this module once.
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import { getSettings, updateSettings } from './settings.mjs';
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

test('updateSettings still validates/applies projectDir exactly as before', () => {
  const dir = os.tmpdir();
  const result = updateSettings({ projectDir: dir });
  assert.equal(result.projectDir, dir);
  assert.throws(() => updateSettings({ projectDir: '/definitely/not/a/real/path/xyz' }), /Not a directory/);
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
