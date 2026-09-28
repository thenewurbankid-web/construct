import test from 'node:test';
import assert from 'node:assert/strict';
import { generateViewState, effectiveMode } from './GenerateState.ts';

const base = {
  actionId: 'a',
  actionKind: 'k',
  label: 'Do it',
  mechanical: { block: 'b', command: 'construct b' },
  ai: { allowed: true, model: 'qwen' },
  willSend: { files: 1, bytes: 100, calls: 1 },
  target: 't',
  disabledReason: null,
  modelOffline: false,
  mode: 'mechanical',
  running: false,
  result: null,
  onRun: () => {},
  onCancel: () => {},
  onChooseMode: () => {},
};

test('generateViewState: all seven states of ia-generate-states', () => {
  assert.equal(generateViewState({ ...base }), 'idle');
  assert.equal(generateViewState({ ...base, mode: 'ai' }), 'ai-disclosure');
  assert.equal(generateViewState({ ...base, running: true }), 'running');
  assert.equal(generateViewState({ ...base, result: { ok: true, summary: 'Done' } }), 'result');
  assert.equal(generateViewState({ ...base, mode: 'ai', modelOffline: true }), 'refused-offline');
  assert.equal(generateViewState({ ...base, disabledReason: 'Select part of the page first' }), 'disabled');
  assert.equal(generateViewState({ ...base, mechanical: null }), 'ai-only');
});

test('generateViewState: running and result outrank every other state', () => {
  assert.equal(generateViewState({ ...base, running: true, disabledReason: 'x', mechanical: null }), 'running');
  assert.equal(generateViewState({ ...base, result: { ok: false, summary: 'x' }, disabledReason: 'x' }), 'result');
});

test('effectiveMode: AI is never kept selected while the model is offline', () => {
  assert.equal(effectiveMode('ai', { ...base, modelOffline: true }), 'mechanical');
  assert.equal(effectiveMode('ai', { ...base, modelOffline: false }), 'ai');
  assert.equal(effectiveMode('mechanical', { ...base, mechanical: null }), 'ai');
});
