// #948 item 6 -- schemas wherever `format` was missing. callLlm refuses a call with no output shape (with an example);
// Ollama gets `format` / a prefilled raw prompt with `stop` / `num_predict`; specFromRequirement sends the v1
// machine-spec schema; AI compare asks one acceptance line per request with acceptanceId/codeUnit enums; Studio's
// planner sends the storyboard schema and retries with only the last rejection. Fake models only.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { callLlm, PROVIDERS, outputShape, ollamaBody, shapedPrompt } from '../packages/core/llm.mjs';
import { ConstructError } from '../packages/core/diagnostics.mjs';
import { draftMachineSpec, splitRequirement } from '../packages/core/research/specFromRequirement.mjs';
import { storyCiteSchema, buildStoryCiteLinePrompt, parseStoryCitation, NO_CODE_UNIT, verifyStoryCitations } from '../packages/core/story.mjs';
import { validate } from '../packages/engine/line/harness/toolHarness.mjs';
import { storyboardSchema } from '../studio-export/src/storyboard.mjs';
import { planStoryboard } from '../studio-export/src/planner.mjs';
import { validateConfig } from '../studio-export/src/models.mjs';
import { goodStoryboard } from '../studio-export/test/studio-helpers.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const withLegacy = async (fn) => { const prev = process.env.LINE_LEGACY_IO; process.env.LINE_LEGACY_IO = '1'; try { return await fn(); } finally { if (prev === undefined) delete process.env.LINE_LEGACY_IO; else process.env.LINE_LEGACY_IO = prev; } };

test('callLlm refuses a call with no output shape, naming a valid one; LINE_LEGACY_IO=1 still allows it', async () => {
  const original = PROVIDERS.claude;
  let called = 0;
  PROVIDERS.claude = () => { called += 1; return 'free text'; };
  try {
    await assert.rejects(() => callLlm('claude', 'Tell me about the file.'), (e) => e instanceof ConstructError && e.exitCode === 2 && /needs an output shape: options\.output = \{format: <JSON Schema>\}[\s\S]*\{prefill: /.test(e.message));
    await assert.rejects(() => callLlm('claude', 'x', { output: { stop: ['\n}'] } }), /needs an output shape/, 'a stop without a prefill is no shape');
    assert.equal(called, 0);
    assert.equal(await callLlm('claude', 'x', { output: { format: 'json' } }), 'free text');
    assert.equal(await withLegacy(() => callLlm('claude', 'x')), 'free text');
  } finally { PROVIDERS.claude = original; }
});

test('Ollama gets format for a choice, a prefilled raw ChatML prompt with stop for code, and num_predict', () => {
  const schema = { type: 'object', properties: { pick: { enum: ['a', 'b'] } }, required: ['pick'] };
  assert.deepEqual(ollamaBody({ model: 'm', prompt: 'p', stream: false, numCtx: 4096, shape: outputShape({ output: { format: schema, numPredict: 50 } }) }), { model: 'm', prompt: 'p', stream: false, format: schema, options: { num_ctx: 4096, num_predict: 50 } });
  const code = ollamaBody({ model: 'm', prompt: 'Write it.', stream: false, numCtx: 4096, shape: outputShape({ output: { prefill: 'export function f(): number {\n', stop: ['\n}'], system: 'S' } }) });
  assert.equal(code.raw, true);
  assert.deepEqual(code.options.stop, ['\n}']);
  assert.ok(code.prompt.startsWith('<|im_start|>system\nS<|im_end|>') && code.prompt.endsWith('<|im_start|>assistant\nexport function f(): number {\n'));
  assert.match(shapedPrompt('Q', outputShape({ output: { format: schema } })), /Reply with ONLY one JSON value that fits this JSON Schema:\n\{"type":"object"/);
});

test('specFromRequirement sends the v1 machine-spec schema as format; a text reply is refused with the violations', async () => {
  const schema = JSON.parse(fs.readFileSync(path.join(REPO, 'packages/core/research/machine-spec.v1.schema.json'), 'utf8'));
  const original = PROVIDERS.claude;
  const seen = [];
  PROVIDERS.claude = (prompt, options) => { seen.push(options); return 'Sure! Here is the spec you asked for.'; };
  try {
    const r = await draftMachineSpec('claude', splitRequirement('A visitor signs in.'), { maxAttempts: 2 });
    assert.equal(r.status, 'rejected');
    assert.match(r.report, /did not parse as JSON/);
    assert.equal(seen.length, 2);
    assert.deepEqual(seen[0].output.format, schema);
  } finally { PROVIDERS.claude = original; }
});

test('AI compare: one acceptance line per request, acceptanceId and codeUnit as enums; a text or invented reply is dropped', () => {
  const s = storyCiteSchema('S1', ['Happy path', 'Refund']);
  assert.deepEqual(s.properties.acceptanceId.enum, ['S1']);
  assert.deepEqual(s.properties.codeUnit.enum, ['Happy path', 'Refund', NO_CODE_UNIT]);
  assert.deepEqual(validate(s, { acceptanceId: 'S1', codeUnit: 'Happy path', note: 'x' }), []);
  assert.ok(validate(s, { acceptanceId: 'S2', codeUnit: 'Invented' }).length === 2);
  const prompt = buildStoryCiteLinePrompt({ id: 'S1', text: 'A refund shows' }, ['Happy path']);
  assert.match(prompt, /Acceptance: S1 A refund shows/);
  assert.match(prompt, /for example \{"acceptanceId": "S1", "codeUnit": "Happy path"/);
  assert.deepEqual(parseStoryCitation('I think S1 is Happy path.'), { invalid: 'I think S1 is Happy path.' });
  assert.equal(parseStoryCitation(JSON.stringify({ acceptanceId: 'S1', codeUnit: NO_CODE_UNIT })), null);
  const { dropped } = verifyStoryCitations([parseStoryCitation('{"acceptanceId":"S9","codeUnit":"Happy path"}')], { acceptanceIds: ['S1'], codeUnitIds: ['Happy path'] });
  assert.match(dropped[0].reason, /unknown acceptance id "S9"/);
});

test('Studio planner: the storyboard schema is the format; a retry carries only the last rejected reply', async () => {
  const schema = storyboardSchema();
  assert.deepEqual(validate(schema, goodStoryboard('http://127.0.0.1:1/')), []);
  assert.ok(validate(schema, { title: 't', scenes: [{ caption: 'c', steps: [{ action: 'eval', code: 'alert(1)' }] }] }).length > 0, 'an action outside the closed set does not fit');
  const sent = [];
  const replies = ['not json', '{"title": "t", "scenes": []}', JSON.stringify(goodStoryboard('http://127.0.0.1:1/'))];
  const provider = { chat: async ({ messages, json }) => { sent.push({ messages: messages.map((m) => m.role), json }); return replies[sent.length - 1]; } };
  const config = validateConfig({ allowPrivateNetwork: true }).config;
  const r = await planStoryboard({ messages: [{ role: 'user', content: 'Show the shop.' }], url: 'http://127.0.0.1:1/', config, provider, fetch: async () => { throw new Error('offline'); } });
  assert.equal(r.ok, true, JSON.stringify(r.error));
  assert.equal(r.attempts, 3);
  assert.deepEqual(sent[0].json, schema);
  assert.deepEqual(sent.map((s) => s.messages.length), [2, 4, 4], 'the history stays one rejection long');
});
