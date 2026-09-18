// Optional, opt-in integration test against a REAL local Ollama instance —
// #98's verification bar treats this as "a bonus, not required" since a
// live Ollama/model isn't assumed to be available in a sandboxed CI/dev
// environment. Skipped unless CONSTRUCT_TEST_LIVE_OLLAMA=1 is set AND a
// real model name is given via CONSTRUCT_TEST_OLLAMA_MODEL (defaults to
// DEFAULT_OLLAMA_MODEL) — never runs as part of a normal `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PROVIDERS, DEFAULT_OLLAMA_MODEL } from '../src/llm.mjs';

const live = process.env.CONSTRUCT_TEST_LIVE_OLLAMA === '1';

test('PROVIDERS.ollama against a real local Ollama server', { skip: !live }, async () => {
  const model = process.env.CONSTRUCT_TEST_OLLAMA_MODEL || DEFAULT_OLLAMA_MODEL;
  const out = await PROVIDERS.ollama('Reply with exactly the word: pong', { model });
  assert.equal(typeof out, 'string');
  assert.ok(out.length > 0);
});
