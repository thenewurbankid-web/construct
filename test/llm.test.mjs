import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { callLlm, stripCodeFence, PROVIDERS, DEFAULT_OLLAMA_MODEL, DEFAULT_OLLAMA_BASE_URL, DEFAULT_LLM_TIMEOUT_SEC, resolveLlmTimeoutMs, ollamaContextFor, MIN_OLLAMA_CONTEXT, MAX_OLLAMA_CONTEXT } from '../packages/core/llm.mjs';
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
  // A short prompt still gets MIN_OLLAMA_CONTEXT, not Ollama's own small undocumented default —
  // this is the actual fix: num_ctx is now always explicit, never left unset.
  assert.equal(body.options.num_ctx, MIN_OLLAMA_CONTEXT);
});

test('ollamaContextFor sizes to the prompt, rounds up to a power of two, and clamps to [MIN,MAX]', () => {
  assert.equal(ollamaContextFor('x'), MIN_OLLAMA_CONTEXT, 'a tiny prompt never asks for less than the floor');
  assert.equal(ollamaContextFor('x'.repeat(1000)), MIN_OLLAMA_CONTEXT, 'still small enough to fit the floor');
  // ~40,000 chars -> ~10,000 prompt tokens + 1024 reserve -> next power of two is 16384.
  assert.equal(ollamaContextFor('x'.repeat(40000)), 16384);
  // A prompt far larger than any real model's ceiling clamps at MAX, never grows unbounded.
  assert.equal(ollamaContextFor('x'.repeat(10_000_000)), MAX_OLLAMA_CONTEXT);
});

test('PROVIDERS.ollama: a real import-sized prompt gets a larger num_ctx than the default, and it is a power of two', async () => {
  const calls = [];
  await withFakeFetch(async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify({ response: 'ok' }) };
  }, async () => {
    // Simulate a real port prompt with a sizeable inlined source file — big enough that the old
    // (unset num_ctx) behavior would have silently truncated most of it.
    await PROVIDERS.ollama(`instructions...\n${'const line = 1;\n'.repeat(2000)}`);
  });
  const body = JSON.parse(calls[0].init.body);
  assert.ok(body.options.num_ctx > MIN_OLLAMA_CONTEXT, `expected a larger window than the floor, got ${body.options.num_ctx}`);
  assert.equal(Math.log2(body.options.num_ctx) % 1, 0, 'num_ctx should be a power of two');
});

test('PROVIDERS.ollama: an explicit { numCtx } option overrides the computed size', async () => {
  const calls = [];
  await withFakeFetch(async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, text: async () => JSON.stringify({ response: 'ok' }) };
  }, async () => {
    await PROVIDERS.ollama('hi', { numCtx: 8192 });
  });
  assert.equal(JSON.parse(calls[0].init.body).options.num_ctx, 8192);
});

test('PROVIDERS.ollama warns (but still calls) when even MAX_OLLAMA_CONTEXT cannot fit the prompt', async () => {
  const originalWarn = console.warn;
  const warnings = [];
  console.warn = (msg) => warnings.push(msg);
  try {
    await withFakeFetch(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ response: 'ok' }) }), async () => {
      await PROVIDERS.ollama('x'.repeat(MAX_OLLAMA_CONTEXT * 5));
    });
  } finally {
    console.warn = originalWarn;
  }
  assert.ok(warnings.some((w) => w.includes('may not fully fit')), JSON.stringify(warnings));
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

// ---- #599: streaming, onChunk and external cancel for the ollama provider ---------------------

const ndjson = (objs) => new ReadableStream({
  start(controller) {
    const enc = new TextEncoder();
    for (const o of objs) controller.enqueue(enc.encode(`${JSON.stringify(o)}\n`));
    controller.close();
  },
});

test('#599: PROVIDERS.ollama with onChunk streams (stream:true) and hands each piece over as it arrives', async () => {
  const calls = [];
  const chunks = [];
  await withFakeFetch(async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, body: ndjson([{ response: 'const ', done: false }, { response: 'x = ', done: false }, { response: '1;', done: false }, { response: '', done: true }]) };
  }, async () => {
    const out = await PROVIDERS.ollama('write', { onChunk: (c) => chunks.push(c) });
    assert.equal(out, 'const x = 1;');
  });
  assert.equal(JSON.parse(calls[0].init.body).stream, true);
  assert.deepEqual(chunks, ['const ', 'x = ', '1;'], 'each non-empty piece, in order, exactly once');
});

test('#599: without onChunk the ollama call is still the single non-streamed request', async () => {
  const calls = [];
  await withFakeFetch(async (url, init) => {
    calls.push(init);
    return { ok: true, status: 200, text: async () => JSON.stringify({ response: 'ok' }) };
  }, async () => { await PROVIDERS.ollama('hi'); });
  assert.equal(JSON.parse(calls[0].body).stream, false);
});

test('#599: a non-JSON line in the stream is a real error, not silently skipped', async () => {
  await withFakeFetch(async () => ({
    ok: true,
    status: 200,
    body: new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('not json\n')); c.close(); } }),
  }), async () => {
    await assert.rejects(() => PROVIDERS.ollama('x', { onChunk() {} }), /non-JSON line/);
  });
});

test('#599: an external AbortSignal cancels an in-flight ollama call and is reported as cancelled, not a timeout', async () => {
  const controller = new AbortController();
  await withFakeFetch((url, init) => new Promise((resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    setTimeout(() => controller.abort(), 10);
  }), async () => {
    await assert.rejects(() => PROVIDERS.ollama('x', { signal: controller.signal }), (err) => err.cancelled === true && /cancelled/.test(err.message));
  });
});

test('#599: an already-aborted signal cancels before any request is made', async () => {
  const controller = new AbortController();
  controller.abort();
  let fetched = false;
  await withFakeFetch(async () => { fetched = true; return { ok: true, status: 200, text: async () => '{}' }; }, async () => {
    await assert.rejects(() => PROVIDERS.ollama('x', { signal: controller.signal }), (err) => err.cancelled === true);
  });
  assert.equal(fetched, false);
});

// ---- #599: the claude provider streams asynchronously (never blocks the event loop) -----------
// A fake `claude` on PATH prints the same stream-json events the real CLI does, so this proves the
// parsing, the streaming, the cancel and the non-blocking behaviour without spending a token.

function withFakeClaudeBin(script, fn) {
  const dir = makeTempDir('construct-fake-claude-');
  const bin = path.join(dir, 'claude');
  fs.writeFileSync(bin, `#!/usr/bin/env node\n${script}`);
  fs.chmodSync(bin, 0o755);
  const originalPath = process.env.PATH;
  process.env.PATH = `${dir}${path.delimiter}${originalPath}`;
  return (async () => {
    try {
      return await fn();
    } finally {
      process.env.PATH = originalPath;
    }
  })();
}

const STREAM_SCRIPT = `
process.stdin.resume(); process.stdin.on('data', () => {});
const ev = (text) => JSON.stringify({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
let i = 0; const pieces = ['export ', 'const x', ' = 1;'];
const t = setInterval(() => {
  if (i < pieces.length) { console.log(ev(pieces[i++])); return; }
  clearInterval(t);
  console.log(JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: pieces.join('') }));
}, 40);
`;

test('#599: PROVIDERS.claude with onChunk streams each text_delta as it arrives and returns the final result', async () => {
  const chunks = [];
  await withFakeClaudeBin(STREAM_SCRIPT, async () => {
    const out = await PROVIDERS.claude('write', { onChunk: (c) => chunks.push(c) });
    assert.equal(out, 'export const x = 1;');
  });
  assert.deepEqual(chunks, ['export ', 'const x', ' = 1;']);
});

test('#599: the streaming claude call does not block the event loop (the server can keep sending frames)', async () => {
  let ticks = 0;
  const iv = setInterval(() => { ticks += 1; }, 10);
  try {
    await withFakeClaudeBin(STREAM_SCRIPT, () => PROVIDERS.claude('write', { onChunk() {} }));
  } finally {
    clearInterval(iv);
  }
  assert.ok(ticks >= 5, `the event loop ran ${ticks} ticks during a ~200ms call; the old spawnSync path would give 0`);
});

test('#599: a cancel signal kills the streaming claude child and is reported as cancelled', async () => {
  const controller = new AbortController();
  await withFakeClaudeBin(`process.stdin.resume(); setInterval(() => {}, 1000);`, async () => {
    setTimeout(() => controller.abort(), 60);
    await assert.rejects(() => PROVIDERS.claude('x', { signal: controller.signal }), (err) => err.cancelled === true);
  });
});

test('#599: an is_error result from the streaming claude call is a real error, not an empty success', async () => {
  await withFakeClaudeBin(`process.stdin.resume(); process.stdin.on('data', () => {}); console.log(JSON.stringify({ type: 'result', is_error: true, result: 'rate limited' })); process.exit(1);`, async () => {
    await assert.rejects(() => PROVIDERS.claude('x', { onChunk() {} }), /rate limited/);
  });
});

test('#599: without onChunk or signal the claude provider is still the plain call (no stream-json flags)', async () => {
  await withFakeClaudeBin(`process.stdin.resume(); process.stdin.on('data', () => {}); process.stdin.on('end', () => { console.log(process.argv.includes('stream-json') ? 'STREAMING' : 'plain'); });`, async () => {
    assert.equal((await PROVIDERS.claude('x')).trim(), 'plain');
  });
});
