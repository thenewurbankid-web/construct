import test from 'node:test';
import assert from 'node:assert/strict';
import { callLlm, stripCodeFence, PROVIDERS, DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_BASE_URL } from '../src/llm.mjs';
import { ConstructError } from '../src/diagnostics.mjs';

test('callLlm throws a clear USAGE_ERROR for an unsupported provider', async () => {
  await assert.rejects(() => callLlm('gpt-nope', 'hi'), (err) => {
    assert.ok(err instanceof ConstructError);
    assert.match(err.message, /Unknown --llm provider "gpt-nope"/);
    assert.match(err.message, /claude/);
    return true;
  });
});

test('callLlm dispatches to the named provider and returns its output', async () => {
  const original = PROVIDERS.claude;
  PROVIDERS.claude = (prompt) => `echo:${prompt}`;
  try {
    assert.equal(await callLlm('claude', 'hello'), 'echo:hello');
  } finally {
    PROVIDERS.claude = original;
  }
});

test('callLlm awaits an async provider just as readily as a sync one', async () => {
  const original = PROVIDERS.claude;
  PROVIDERS.claude = async (prompt) => `async-echo:${prompt}`;
  try {
    assert.equal(await callLlm('claude', 'hello'), 'async-echo:hello');
  } finally {
    PROVIDERS.claude = original;
  }
});

test('stripCodeFence removes exactly one wrapping ``` fence', () => {
  assert.equal(stripCodeFence('```ts\nexport const x = 1;\n```'), 'export const x = 1;');
  assert.equal(stripCodeFence('```\nplain\n```'), 'plain');
});

test('stripCodeFence leaves unfenced content untouched', () => {
  assert.equal(stripCodeFence('export const x = 1;'), 'export const x = 1;');
});

test('stripCodeFence trims surrounding whitespace either way', () => {
  assert.equal(stripCodeFence('  \nexport const x = 1;\n  '), 'export const x = 1;');
});

// ---- ollama provider ("PROVIDERS.ollama") — matches #98's verification
// bar: no live Ollama instance is assumed to be available in CI/dev
// sandboxes, so these mock `global.fetch` rather than hitting a real
// server. See test/llm.ollama-live.test.mjs (skipped unless
// CONSTRUCT_TEST_LIVE_OLLAMA=1) for the opt-in real-server counterpart.

function withFakeFetch(impl, fn) {
  const original = global.fetch;
  global.fetch = impl;
  return (async () => {
    try {
      return await fn();
    } finally {
      global.fetch = original;
    }
  })();
}

test('PROVIDERS.ollama posts to /api/generate with the default model + base URL and returns the response text', async () => {
  const calls = [];
  await withFakeFetch(async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ response: 'const x = 1;' }),
    };
  }, async () => {
    const out = await PROVIDERS.ollama('write me a file');
    assert.equal(out, 'const x = 1;');
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${DEFAULT_OLLAMA_BASE_URL}/api/generate`);
  assert.equal(calls[0].init.method, 'POST');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.model, DEFAULT_OLLAMA_MODEL);
  assert.equal(body.prompt, 'write me a file');
  assert.equal(body.stream, false);
});

test('PROVIDERS.ollama honors an explicit { model, baseUrl } option', async () => {
  const calls = [];
  await withFakeFetch(async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify({ response: 'ok' }) };
  }, async () => {
    await PROVIDERS.ollama('hi', { model: 'qwen2.5-coder:1.5b', baseUrl: 'http://localhost:9999' });
  });

  assert.equal(calls[0].url, 'http://localhost:9999/api/generate');
  assert.equal(JSON.parse(calls[0].init.body).model, 'qwen2.5-coder:1.5b');
});

test('callLlm("ollama", prompt, options) threads options through to the provider', async () => {
  const calls = [];
  await withFakeFetch(async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify({ response: 'ok' }) };
  }, async () => {
    const out = await callLlm('ollama', 'hi', { model: 'qwen2.5-coder:32b' });
    assert.equal(out, 'ok');
  });
  assert.equal(JSON.parse(calls[0].init.body).model, 'qwen2.5-coder:32b');
});

test('PROVIDERS.ollama throws a ConstructError when the fetch itself fails (Ollama not running)', async () => {
  await withFakeFetch(async () => {
    throw new Error('connect ECONNREFUSED');
  }, async () => {
    await assert.rejects(() => PROVIDERS.ollama('hi'), (err) => {
      assert.ok(err instanceof ConstructError);
      assert.match(err.message, /Could not reach Ollama/);
      assert.match(err.message, /ECONNREFUSED/);
      return true;
    });
  });
});

test('PROVIDERS.ollama throws a ConstructError on a non-2xx HTTP status', async () => {
  await withFakeFetch(async () => ({
    ok: false,
    status: 404,
    text: async () => 'model "qwen2.5-coder:7b" not found, try pulling it first',
  }), async () => {
    await assert.rejects(() => PROVIDERS.ollama('hi'), (err) => {
      assert.ok(err instanceof ConstructError);
      assert.match(err.message, /responded 404/);
      assert.match(err.message, /not found/);
      return true;
    });
  });
});

test('PROVIDERS.ollama throws a ConstructError on a non-JSON response body', async () => {
  await withFakeFetch(async () => ({ ok: true, status: 200, text: async () => 'not json' }), async () => {
    await assert.rejects(() => PROVIDERS.ollama('hi'), (err) => {
      assert.ok(err instanceof ConstructError);
      assert.match(err.message, /non-JSON response/);
      return true;
    });
  });
});

test('PROVIDERS.ollama throws a ConstructError when the JSON body has no "response" string field', async () => {
  await withFakeFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ done: true }) }), async () => {
    await assert.rejects(() => PROVIDERS.ollama('hi'), (err) => {
      assert.ok(err instanceof ConstructError);
      assert.match(err.message, /no "response" string field/);
      return true;
    });
  });
});
