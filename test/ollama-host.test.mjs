import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOllamaHost, OLLAMA_DEFAULT_URL } from '../packages/core/ollama-host.mjs';
import { OLLAMA_DEFAULT_URL as MACHINE_DEFAULT } from '../packages/core/machine.mjs';
import { PROVIDERS, DEFAULT_OLLAMA_BASE_URL } from '../packages/core/llm.mjs';
import { getOllamaStatus } from '../ui/server/src/ollama.mjs';

test('#865: normalizeOllamaHost adds a scheme, a default port, and maps a bind-all address to loopback', () => {
  assert.equal(OLLAMA_DEFAULT_URL, 'http://127.0.0.1:11434');
  assert.equal(normalizeOllamaHost(undefined), OLLAMA_DEFAULT_URL);
  assert.equal(normalizeOllamaHost(''), OLLAMA_DEFAULT_URL);
  assert.equal(normalizeOllamaHost('0.0.0.0:11434'), 'http://127.0.0.1:11434');
  assert.equal(normalizeOllamaHost('0.0.0.0'), 'http://127.0.0.1:11434');
  assert.equal(normalizeOllamaHost('localhost:11434'), 'http://localhost:11434');
  assert.equal(normalizeOllamaHost('gpu-box:9999'), 'http://gpu-box:9999');
  assert.equal(normalizeOllamaHost('https://ollama.example.com/'), 'https://ollama.example.com');
  assert.equal(normalizeOllamaHost('http://127.0.0.1:22222/'), 'http://127.0.0.1:22222');
});

test('#865: one default everywhere (machine, llm, ui server)', () => {
  assert.equal(MACHINE_DEFAULT, OLLAMA_DEFAULT_URL);
  assert.equal(DEFAULT_OLLAMA_BASE_URL, OLLAMA_DEFAULT_URL);
});

function withEnvFetch(host, fn) {
  const origFetch = globalThis.fetch;
  const origHost = process.env.OLLAMA_HOST;
  const urls = [];
  process.env.OLLAMA_HOST = host;
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return { ok: true, json: async () => ({ version: '1', response: 'ok', done: true }) };
  };
  return fn(urls).finally(() => {
    globalThis.fetch = origFetch;
    if (origHost === undefined) delete process.env.OLLAMA_HOST;
    else process.env.OLLAMA_HOST = origHost;
  });
}

test('#865: ui/server ollama.mjs normalises a scheme-less OLLAMA_HOST', () =>
  withEnvFetch('0.0.0.0:11434', async (urls) => {
    const status = await getOllamaStatus();
    assert.equal(urls[0], 'http://127.0.0.1:11434/api/version');
    assert.equal(status.host, 'http://127.0.0.1:11434');
  }));

test('#865: llm.mjs ollama provider normalises a scheme-less OLLAMA_HOST', () =>
  withEnvFetch('localhost:11434', async (urls) => {
    await PROVIDERS.ollama('hi', { model: 'x' }).catch(() => {});
    assert.ok(urls[0]?.startsWith('http://localhost:11434/'), urls[0]);
  }));
