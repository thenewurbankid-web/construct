import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { callLlm, stripCodeFence, PROVIDERS, DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_BASE_URL, DEFAULT_LLM_TIMEOUT_SEC, resolveLlmTimeoutMs } from '../packages/core/llm.mjs';
import { ConstructError } from '../packages/core/diagnostics.mjs';

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

// ---- timeouts (#413) — a model that never answers must not hang the caller.

test('resolveLlmTimeoutMs: CONSTRUCT_LLM_TIMEOUT_SEC in seconds, default 300, nonsense ignored', () => {
  assert.equal(resolveLlmTimeoutMs({}), DEFAULT_LLM_TIMEOUT_SEC * 1000);
  assert.equal(resolveLlmTimeoutMs({ CONSTRUCT_LLM_TIMEOUT_SEC: '12' }), 12_000);
  assert.equal(resolveLlmTimeoutMs({ CONSTRUCT_LLM_TIMEOUT_SEC: '0.5' }), 500);
  for (const bad of ['0', '-3', 'soon', '']) assert.equal(resolveLlmTimeoutMs({ CONSTRUCT_LLM_TIMEOUT_SEC: bad }), DEFAULT_LLM_TIMEOUT_SEC * 1000, JSON.stringify(bad));
});

/** Put a stub `claude` executable first on PATH for the duration of `fn`. */
async function withStubClaude(script, fn) {
  const bin = makeTempDir('stub-claude-');
  const exe = path.join(bin, 'claude');
  fs.writeFileSync(exe, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
  const priorPath = process.env.PATH;
  process.env.PATH = `${bin}${path.delimiter}${priorPath}`;
  try {
    return await fn();
  } finally {
    process.env.PATH = priorPath;
  }
}

test('PROVIDERS.claude: a CLI that never answers is killed at the timeout with an error naming it', async () => {
  await withStubClaude('cat >/dev/null; sleep 30; echo late', async () => {
    const started = Date.now();
    await assert.rejects(() => callLlm('claude', 'hi', { timeoutMs: 300 }), (err) => {
      assert.ok(err instanceof ConstructError);
      assert.match(err.message, /"claude" model did not answer within 0\.3 seconds/);
      assert.match(err.message, /CONSTRUCT_LLM_TIMEOUT_SEC/);
      return true;
    });
    assert.ok(Date.now() - started < 10_000, 'did not wait for the 30 s sleep');
  });
});

test('PROVIDERS.claude: the environment variable bounds the call when no per-call timeout is given', async () => {
  const prior = process.env.CONSTRUCT_LLM_TIMEOUT_SEC;
  process.env.CONSTRUCT_LLM_TIMEOUT_SEC = '0.3';
  try {
    await withStubClaude('cat >/dev/null; sleep 30', async () => {
      // `callLlm` (async) rather than the sync provider: assert.rejects treats a synchronous throw as a failure.
      await assert.rejects(() => callLlm('claude', 'hi'), /did not answer within 0\.3 seconds/);
    });
  } finally {
    if (prior === undefined) delete process.env.CONSTRUCT_LLM_TIMEOUT_SEC; else process.env.CONSTRUCT_LLM_TIMEOUT_SEC = prior;
  }
});

test('PROVIDERS.claude: a CLI that answers in time is unaffected by the timeout', async () => {
  await withStubClaude('cat >/dev/null; echo answered', async () => {
    assert.equal((await PROVIDERS.claude('hi', { timeoutMs: 5000 })).trim(), 'answered');
  });
});

test('PROVIDERS.ollama: passes an AbortSignal and turns its timeout into a clear ConstructError', async () => {
  let sawSignal = null;
  await withFakeFetch((url, init) => new Promise((resolve, reject) => {
    sawSignal = init.signal;
    // A server that never answers: settle only when the caller's own signal fires.
    init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
  }), async () => {
    await assert.rejects(() => PROVIDERS.ollama('hi', { timeoutMs: 100 }), (err) => {
      assert.ok(err instanceof ConstructError);
      assert.match(err.message, /"ollama" model did not answer within 0\.1 seconds/);
      assert.match(err.message, /CONSTRUCT_LLM_TIMEOUT_SEC/);
      return true;
    });
  });
  assert.ok(sawSignal instanceof AbortSignal, 'fetch received a signal');
  assert.equal(sawSignal.aborted, true);
});

test('PROVIDERS.ollama: a body that never finishes arriving is bounded by the same timeout', async () => {
  await withFakeFetch((url, init) => Promise.resolve({
    ok: true,
    status: 200,
    text: () => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true })),
  }), async () => {
    await assert.rejects(() => PROVIDERS.ollama('hi', { timeoutMs: 100 }), /did not answer within 0\.1 seconds/);
  });
});
