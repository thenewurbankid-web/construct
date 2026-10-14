import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prefilledGenerate, briefSignature, STOP } from '../prefill.mjs';
import { spliceFunction } from '../spliceApplier.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

test('prefilledGenerate: raw ChatML with the signature prefilled, stop at the closing brace, one function back', async () => {
  let sent = null;
  const fetchImpl = async (url, init) => {
    sent = { url, body: JSON.parse(init.body) };
    // A model that ignores the stop and writes a second function.
    return { ok: true, json: async () => ({ response: '  return [];\n}\n\nexport function addPick(id: string): void {}\n', prompt_eval_count: 9, eval_count: 4 }) };
  };
  const signature = 'export function listPicks(): string[]';
  const c = await prefilledGenerate({ ollama: { url: 'http://x', keepAlive: '1m', timeoutMs: 1000 }, model: 'qwen2.5-coder:1.5b',
    options: { temperature: 0.7 }, system: 'S', user: 'U', signature, lang: 'ts', seed: 3, fetchImpl });
  assert.equal(sent.url, 'http://x/api/generate');
  assert.equal(sent.body.raw, true);
  assert.deepEqual(sent.body.options, { temperature: 0.7, seed: 3, stop: STOP });
  assert.ok(sent.body.prompt.endsWith('<|im_start|>assistant\n```ts\nexport function listPicks(): string[] {\n'));
  assert.doesNotMatch(c.reply, /addPick/);
  assert.equal(spliceFunction('export {};\n', c.reply, 'listPicks', 'x.ts').ok, true);
  assert.deepEqual([c.tokensIn, c.tokensOut], [9, 4]);
  await assert.rejects(prefilledGenerate({ ollama: { url: 'http://x' }, model: 'fable', signature, fetchImpl }), /fable/);
});

test('briefSignature reads a brief\'s SIGNATURE line', () => {
  assert.equal(briefSignature('FUNCTION: f\n\nSIGNATURE: export function f(a: string): void\n\nTASK: x'), 'export function f(a: string): void');
  assert.equal(briefSignature('no signature'), null);
});

test('run.mjs codeRound (arms H, I) asks the coder only through the prefilled call', () => {
  const src = readFileSync(join(HERE, '..', '..', 'run.mjs'), 'utf8');
  const round = src.slice(src.indexOf('async function codeRound'), src.indexOf('const strategies'));
  assert.match(round, /ctx\.prefilled\(/);
  assert.doesNotMatch(round, /ctx\.call\(/);
});
