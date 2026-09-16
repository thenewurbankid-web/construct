import test from 'node:test';
import assert from 'node:assert/strict';
import { callLlm, stripCodeFence, PROVIDERS } from '../src/llm.mjs';
import { ConstructError } from '../src/diagnostics.mjs';

test('callLlm throws a clear USAGE_ERROR for an unsupported provider', () => {
  assert.throws(() => callLlm('gpt-nope', 'hi'), (err) => {
    assert.ok(err instanceof ConstructError);
    assert.match(err.message, /Unknown --llm provider "gpt-nope"/);
    assert.match(err.message, /claude/);
    return true;
  });
});

test('callLlm dispatches to the named provider and returns its output', () => {
  const original = PROVIDERS.claude;
  PROVIDERS.claude = (prompt) => `echo:${prompt}`;
  try {
    assert.equal(callLlm('claude', 'hello'), 'echo:hello');
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
