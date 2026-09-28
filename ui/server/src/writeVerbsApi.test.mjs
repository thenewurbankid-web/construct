// #471: Settings' per-capability model choice must actually reach the fill as `--model <name>` in the argv
// handleCreate/handleImport build for the in-process CLI call — this is the confirmed gap the issue names
// ("the choice does not reach the fill"). `inProcess` is a stub that just records the argv it was given, so
// these stay unit tests: no real file writes, no real model call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handleCreate, handleImport } from './writeVerbsApi.mjs';

const okResult = { httpStatus: 200, ok: true };
const recordingInProcess = (calls) => async (argv) => { calls.push(argv); return okResult; };

test('#471: handleCreate appends --model after --llm when useLlm is true and llmModel() names one', async () => {
  const calls = [];
  await handleCreate({
    body: { kind: 'single', name: 'Widget', feature: 'shop', layer: 'domain', useLlm: true },
    projectDir: null,
    inProcess: recordingInProcess(calls),
    llmProvider: () => 'ollama',
    llmModel: () => 'qwen2.5-coder:7b',
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], ['domain', 'Widget', '--feature', 'shop', '--llm', 'ollama', '--model', 'qwen2.5-coder:7b']);
});

test('#471: handleCreate omits --model when llmModel() has nothing chosen (falls back to the provider default)', async () => {
  const calls = [];
  await handleCreate({
    body: { kind: 'single', name: 'Widget', feature: 'shop', layer: 'domain', useLlm: true },
    projectDir: null,
    inProcess: recordingInProcess(calls),
    llmProvider: () => 'ollama',
    llmModel: () => null,
  });
  assert.deepEqual(calls[0], ['domain', 'Widget', '--feature', 'shop', '--llm', 'ollama']);
});

test('#471: handleCreate never adds --model when the request does not ask for a model fill at all', async () => {
  const calls = [];
  await handleCreate({
    body: { kind: 'single', name: 'Widget', feature: 'shop', layer: 'domain', useLlm: false },
    projectDir: null,
    inProcess: recordingInProcess(calls),
    llmProvider: () => 'ollama',
    llmModel: () => 'qwen2.5-coder:7b',
  });
  assert.deepEqual(calls[0], ['domain', 'Widget', '--feature', 'shop']);
});

test('#471: handleImport appends --model after --llm for the unit form when useLlm is true', async () => {
  const calls = [];
  await handleImport({
    body: { mode: 'unit', name: 'Widget', feature: 'shop', layers: ['domain'], from: '/proj/legacy/widget.js', useLlm: true },
    projectDir: null,
    inProcess: recordingInProcess(calls),
    resolveRead: (v) => v,
    mapError: (e) => ({ status: 400, body: { ok: false, error: String(e) } }),
    llmProvider: () => 'ollama',
    llmModel: () => 'qwen2.5-coder:7b',
  });
  assert.deepEqual(calls[0], ['Widget', '--feature', 'shop', '--layers', 'domain', '--from', '/proj/legacy/widget.js', '--llm', 'ollama', '--model', 'qwen2.5-coder:7b']);
});

test('#471: handleImport appends --model for the plan form too, and an explicit request-level model wins over Settings', async () => {
  const calls = [];
  await handleImport({
    body: { mode: 'plan', planPath: '/proj/plan.json', llm: 'ollama', model: 'llama3:8b' },
    projectDir: null,
    inProcess: recordingInProcess(calls),
    resolveRead: (v) => v,
    mapError: (e) => ({ status: 400, body: { ok: false, error: String(e) } }),
    llmProvider: () => 'claude',
    llmModel: () => 'qwen2.5-coder:7b',
  });
  assert.deepEqual(calls[0], ['--plan', '/proj/plan.json', '--llm', 'ollama', '--model', 'llama3:8b']);
});

test('#471: handleImport omits --model when nothing (request or Settings) names one', async () => {
  const calls = [];
  await handleImport({
    body: { mode: 'plan', planPath: '/proj/plan.json', useLlm: true },
    projectDir: null,
    inProcess: recordingInProcess(calls),
    resolveRead: (v) => v,
    mapError: (e) => ({ status: 400, body: { ok: false, error: String(e) } }),
    llmProvider: () => 'ollama',
    llmModel: () => undefined,
  });
  assert.deepEqual(calls[0], ['--plan', '/proj/plan.json', '--llm', 'ollama']);
});
