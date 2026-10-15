import { test } from 'node:test';
import assert from 'node:assert/strict';
import { llamaModel } from './llama-model.mjs';

test('a free request continues the prefill, with the prompt cached', async () => {
  let sent;
  const model = llamaModel({ model: 'qwen2.5-coder:7b', call: async (body) => ((sent = body), { text: 'existing"}', tokensIn: 50, tokensOut: 3 }) });
  const r = await model({ system: 'S', user: 'U', prefill: '{"entry": "X", "decision": "' });
  assert.equal(sent.cache_prompt, true);
  assert.equal(sent.temperature, 0);
  assert.equal(sent.json_schema, undefined);
  assert.match(sent.prompt, /<\|im_start\|>assistant\n\{"entry": "X", "decision": "$/);
  assert.deepEqual(r, { text: 'existing"}', tokensIn: 50, tokensOut: 3, costUsd: 0, model: 'qwen2.5-coder:7b' });
});

test('a request with a schema is held to it, with no prefill in the prompt', async () => {
  let sent;
  const model = llamaModel({ model: 'qwen2.5-coder:7b', call: async (body) => ((sent = body), { text: '{"answers": []}', tokensIn: 1, tokensOut: 1 }) });
  const schema = { type: 'object', properties: { answers: { type: 'array' } }, required: ['answers'] };
  const r = await model({ system: 'S', user: 'U', prefill: '{"answers": [', schema });
  assert.deepEqual(sent.json_schema, schema);
  assert.match(sent.prompt, /<\|im_start\|>assistant\n$/);
  assert.deepEqual(JSON.parse('{"answers": [' + r.text), { answers: [] });
});
