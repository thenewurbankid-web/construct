import test from 'node:test';
import assert from 'node:assert/strict';
import { getOllamaStatus, listOllamaModels, startOllamaPull, removeOllamaModel } from './ollama.mjs';

// Mocks global fetch per test (restored after each) — no real Ollama daemon
// is assumed to be running in CI/dev sandboxes (see #97's issue comment for
// why the real-daemon path is verified manually/via Playwright instead).
function withFetch(impl, fn) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  return fn().finally(() => {
    globalThis.fetch = original;
  });
}

test('getOllamaStatus reports running:true with the version when the daemon responds', () =>
  withFetch(
    async () => ({ ok: true, json: async () => ({ version: '0.3.12' }) }),
    async () => {
      const status = await getOllamaStatus();
      assert.equal(status.running, true);
      assert.equal(status.version, '0.3.12');
    },
  ));

test('getOllamaStatus reports running:false when the request throws (daemon not running)', () =>
  withFetch(
    async () => { throw new Error('connect ECONNREFUSED'); },
    async () => {
      const status = await getOllamaStatus();
      assert.equal(status.running, false);
    },
  ));

test('getOllamaStatus reports running:false on a non-OK response', () =>
  withFetch(
    async () => ({ ok: false, status: 500 }),
    async () => {
      const status = await getOllamaStatus();
      assert.equal(status.running, false);
    },
  ));

test('listOllamaModels returns the models array from /api/tags', () =>
  withFetch(
    async () => ({ ok: true, json: async () => ({ models: [{ name: 'qwen2.5-coder:0.5b' }] }) }),
    async () => {
      const models = await listOllamaModels();
      assert.deepEqual(models, [{ name: 'qwen2.5-coder:0.5b' }]);
    },
  ));

test('listOllamaModels throws on a non-OK response', () =>
  withFetch(
    async () => ({ ok: false, status: 500 }),
    async () => {
      await assert.rejects(() => listOllamaModels(), /500/);
    },
  ));

test('startOllamaPull returns the raw response for the caller to stream', () =>
  withFetch(
    async (url, opts) => {
      assert.match(url, /\/api\/pull$/);
      assert.equal(JSON.parse(opts.body).name, 'qwen2.5-coder:0.5b');
      return { ok: true, body: {} };
    },
    async () => {
      const res = await startOllamaPull('qwen2.5-coder:0.5b');
      assert.ok(res);
    },
  ));

test('startOllamaPull throws when Ollama rejects the pull', () =>
  withFetch(
    async () => ({ ok: false, status: 404, body: null }),
    async () => {
      await assert.rejects(() => startOllamaPull('nonexistent:tag'), /404/);
    },
  ));

test('removeOllamaModel resolves with the removed name on success', () =>
  withFetch(
    async () => ({ ok: true }),
    async () => {
      const result = await removeOllamaModel('qwen2.5-coder:0.5b');
      assert.deepEqual(result, { removed: 'qwen2.5-coder:0.5b' });
    },
  ));

test('removeOllamaModel throws with Ollama\'s error body on failure', () =>
  withFetch(
    async () => ({ ok: false, status: 404, text: async () => 'model not found' }),
    async () => {
      await assert.rejects(() => removeOllamaModel('nope'), /404.*model not found/s);
    },
  ));
