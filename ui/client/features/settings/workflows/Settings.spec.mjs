import test from 'node:test';
import assert from 'node:assert/strict';
import { initialSettingsState as initial, settingsReducer as reduce } from './Settings.ts';

const settings = {
  projectDir: '/ws/proj',
  llmProviders: { importFill: 'claude', createFill: 'ollama', planAnalysis: 'claude' },
  llmModels: { importFill: null, createFill: 'qwen2.5-coder:7b', planAnalysis: null },
  availableProviders: ['claude', 'ollama'],
  availableProvidersByCapability: { importFill: ['claude', 'ollama'], createFill: ['claude', 'ollama'], planAnalysis: ['claude'] },
  resolvedProjectRoot: '/ws/proj',
  valid: true,
  needsInit: false,
};

test('#471: llmModels defaults every capability to null (the provider default) and loads alongside llmProviders', () => {
  assert.deepEqual(initial.llmModels, { importFill: null, createFill: null, planAnalysis: null });

  const loaded = reduce(initial, { type: 'LOADED', settings });
  assert.deepEqual(loaded.llmModels, settings.llmModels);
  assert.deepEqual(loaded.llmProviders, settings.llmProviders);
});

test('#471: SET_LLM_MODEL sets one capability at a time without disturbing the others or the providers', () => {
  const loaded = reduce(initial, { type: 'LOADED', settings });
  const changed = reduce(loaded, { type: 'SET_LLM_MODEL', capability: 'importFill', value: 'llama3:8b' });
  assert.deepEqual(changed.llmModels, { importFill: 'llama3:8b', createFill: 'qwen2.5-coder:7b', planAnalysis: null });
  assert.deepEqual(changed.llmProviders, settings.llmProviders, 'untouched');
});

test('#471: SET_LLM_MODEL with an empty value clears back to null (the provider default), not an empty string', () => {
  const loaded = reduce(initial, { type: 'LOADED', settings });
  const cleared = reduce(loaded, { type: 'SET_LLM_MODEL', capability: 'createFill', value: '' });
  assert.equal(cleared.llmModels.createFill, null);
});

test('#471: SAVE_OK replaces settings (and llmModels within it) with the server response', () => {
  const saved = reduce(initial, { type: 'SAVE_OK', settings });
  assert.equal(saved.settings, settings);
  assert.deepEqual(saved.status, { ok: true, message: 'Settings saved.' });
});
