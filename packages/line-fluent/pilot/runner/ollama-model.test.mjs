import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isOllamaModel, ollamaModel } from './ollama-model.mjs';

test('an Ollama name has a tag; a Claude name does not', () => {
  assert.equal(isOllamaModel('qwen2.5-coder:7b'), true);
  assert.equal(isOllamaModel('haiku'), false);
  assert.equal(isOllamaModel('none'), false);
});

test('ollamaModel sends a raw prefilled qwen prompt with no format and returns the continuation, free', async () => {
  let sent;
  const model = ollamaModel({ model: 'qwen2.5-coder:7b', call: async (body) => ((sent = body), { text: 'existing"}', tokensIn: 50, tokensOut: 3 }) });
  const r = await model({ system: 'S', user: 'U', prefill: '{"entry": "X", "decision": "' });
  assert.equal(sent.model, 'qwen2.5-coder:7b');
  assert.equal(sent.raw, true);
  assert.equal(sent.format, undefined);
  assert.equal(sent.options.num_ctx, 16384);
  assert.match(sent.prompt, /<\|im_start\|>assistant\n\{"entry": "X", "decision": "$/);
  assert.deepEqual(r, { text: 'existing"}', tokensIn: 50, tokensOut: 3, costUsd: 0, model: 'qwen2.5-coder:7b' });
});
