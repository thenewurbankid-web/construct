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
  assert.equal(sent.options.num_ctx, 8192);
  assert.match(sent.prompt, /<\|im_start\|>assistant\n\{"entry": "X", "decision": "$/);
  assert.deepEqual(r, { text: 'existing"}', tokensIn: 50, tokensOut: 3, costUsd: 0, model: 'qwen2.5-coder:7b' });
});

test('a request with a schema is held to it, with no prefill in the prompt', async () => {
  let sent;
  const model = ollamaModel({ model: 'qwen2.5-coder:7b', call: async (body) => ((sent = body), { text: '{"answers": []}', tokensIn: 1, tokensOut: 1 }) });
  const schema = { type: 'object', properties: { answers: { type: 'array' } }, required: ['answers'] };
  const r = await model({ system: 'S', user: 'U', prefill: '{"answers": [', schema });
  assert.deepEqual(sent.format, schema);
  assert.match(sent.prompt, /<\|im_start\|>assistant\n$/);
  assert.deepEqual(JSON.parse('{"answers": [' + r.text), { answers: [] }); // read back as prefill + text, like readList
});
