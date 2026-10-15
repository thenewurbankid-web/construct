import { test } from 'node:test';
import assert from 'node:assert/strict';
import { studentRequest, parseStudent, callStudent, C2_SCHEMA, DEFAULT_URL } from './student.mjs';

const prefill = '{"entry": "Array.prototype.flatMap", "decision": "';
const request = { system: 'You write C2 answers.', user: 'Entry: Array.prototype.flatMap', prefill };
const rest = 'new-atom", "atom": "flatMapped", "existing": null, "kind": "copy", '
  + '"sentence": "every(x).in(xs).is().mapped().to(f).and().flattened()", "js": "xs.flatMap(f)", '
  + '"params": [["xs", "list"], ["f", "fn"]], "parts": null, "reason": null}';

test('body snapshot', () => {
  assert.deepEqual(studentRequest(request), {
    model: 'qwen2.5-coder:1.5b',
    prompt: '<|im_start|>system\nYou write C2 answers.<|im_end|>\n'
      + '<|im_start|>user\nEntry: Array.prototype.flatMap<|im_end|>\n'
      + `<|im_start|>assistant\n${prefill}`,
    raw: true,
    stream: false,
    format: C2_SCHEMA,
    options: { temperature: 0, num_predict: 256 },
  });
  assert.equal(C2_SCHEMA.title, 'C2 fluent answer');
  const custom = studentRequest(request, { model: 'm', maxTokens: 64, schema: null });
  assert.equal(custom.model, 'm');
  assert.equal('format' in custom, false);
  assert.deepEqual(custom.options, { temperature: 0, num_predict: 64 });
});

test('parse: good output', () => {
  const { answer, error } = parseStudent(prefill, rest);
  assert.equal(error, undefined);
  assert.equal(answer.atom, 'flatMapped');
  assert.deepEqual(Object.keys(answer)[0], 'entry');
  assert.equal(parseStudent(prefill, prefill + rest).answer.atom, 'flatMapped');
});

test('parse: truncated output is one sentence', () => {
  const { answer, error } = parseStudent(prefill, rest.slice(0, 80));
  assert.equal(answer, undefined);
  assert.match(error, /^The output is not one complete JSON object .*bracket\.$/);
});

test('parse: extra field is refused by the contract', () => {
  const { answer, error } = parseStudent(prefill, rest.replace('"reason": null}', '"reason": null, "note": "hi"}'));
  assert.equal(answer, undefined);
  assert.match(error, /Field `note` is not part of the answer/);
});

test('callStudent maps Ollama fields with injected fetch', async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, json: async () => ({ response: rest, prompt_eval_count: 120, eval_count: 60, total_duration: 2_500_000_000 }) };
  };
  const body = studentRequest(request);
  assert.deepEqual(await callStudent(body, { fetch }), { text: rest, tokensIn: 120, tokensOut: 60, ms: 2500 });
  assert.equal(calls[0].url, DEFAULT_URL);
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), body);
  const bad = async () => ({ ok: false, status: 500 });
  await assert.rejects(callStudent(body, { fetch: bad, url: 'http://x/api/generate' }), /500 at http:\/\/x/);
});
