// #948 item 4 -- llm-fill is modelled: a file is filled ONE function at a time, each request prefilled with that
// function's exact signature and stopped at its closing brace, each body behind a tsc gate; a refusal is retried once
// with only its first error as the example, never a growing history. Fake providers only (PROVIDERS.claude swapped):
// one writes two functions, one returns the wrong type; both are refused with an example.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { PROVIDERS } from '../packages/core/llm.mjs';
import { fillByFunction, factsOnly } from '../packages/core/llm-fill.mjs';
import { fillGeneratedFile } from '../packages/core/generators.mjs';
import { autoFixViolations } from '../packages/core/import.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

async function withFake(reply, fn) {
  const original = PROVIDERS.claude;
  const calls = [];
  PROVIDERS.claude = (prompt, options) => { calls.push({ prompt, options }); return reply(calls.length, prompt, options); };
  try { return { result: await fn(), calls }; } finally { PROVIDERS.claude = original; }
}

const SOURCE = 'export function count(xs: number[]): number {\n  return 0;\n}\n\nexport function label(n: number): string {\n  return "";\n}\n';

test('fillByFunction: one request per function, each prefilled; two functions in one reply and a tsc error are refused with an example', async () => {
  const { result, calls } = await withFake((n, _p, o) => {
    if (o.output.prefill.startsWith('export function count')) return n === 1 ? '  return xs.length;\n}\nexport function extra() {\n  return 1;\n}' : '  return xs.length;\n}';
    return n === 3 ? '  return n;\n}' : '  return `${n} items`;\n}';
  }, () => fillByFunction('claude', 'Port the counting helpers.\nReturn ONLY the new, complete file content. No fences.', {}, { source: SOURCE, file: 'features/a/domain/count.ts' }));
  assert.equal(result.status, 'filled');
  assert.deepEqual(result.functions, ['count', 'label']);
  assert.equal(calls.length, 4);
  assert.deepEqual(calls.map((c) => c.options.output.prefill), ['export function count(xs: number[]): number {\n', 'export function count(xs: number[]): number {\n', 'export function label(n: number): string {\n', 'export function label(n: number): string {\n']);
  assert.deepEqual(calls[0].options.output.stop, ['\n}']);
  assert.match(calls[1].prompt, /Refused \(ONE_FUNCTION\)[\s\S]*a valid reply is only/);
  assert.match(calls[3].prompt, /Refused \(TSC\): tsc TS2322[\s\S]*a valid reply is only/, 'the retry carries the first error as an example');
  assert.ok(!calls[3].prompt.includes('ONE_FUNCTION'), 'no growing history: the count refusal is not carried into label');
  assert.ok(!calls[0].prompt.includes('Return ONLY the new, complete file content'), 'the whole-file output line is dropped');
  assert.equal(result.code, 'export function count(xs: number[]): number {\n  return xs.length;\n}\n\nexport function label(n: number): string {\n  return `${n} items`;\n}');
});

test('fillByFunction: a file with no function is rejected without a model call; a body refused twice rejects the file', async () => {
  const none = await withFake(() => 'x', () => fillByFunction('claude', 'P', {}, { source: 'export type A = { n: number };\n', file: 't.ts' }));
  assert.equal(none.calls.length, 0);
  assert.equal(none.result.status, 'rejected');
  assert.match(none.result.reason, /no function to fill/);
  const bad = await withFake(() => '  return "no";\n}', () => fillByFunction('claude', 'P', {}, { source: SOURCE, file: 't.ts', lines: [2] }));
  assert.equal(bad.calls.length, 2, 'only the function at line 2, two attempts');
  assert.equal(bad.result.status, 'rejected');
  assert.match(bad.result.reason, /^count: Refused \(TSC\)/);
  assert.equal(factsOnly('a\nReturn ONLY the new, complete file content. x\nb'), 'a\nb');
});

test('fillGeneratedFile and autoFixViolations use the modelled fill (one function, no attempt history)', async () => {
  const root = makeTempDir('modelled-fill-');
  const file = path.join(root, 'features/checkout/domain/Total.ts');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, 'export function Total(xs: number[]): number {\n  return 0;\n}\n');
  const filled = await withFake(() => '  return xs.reduce((s, x) => s + x, 0);\n}', () => fillGeneratedFile(root, file, 'domain', { llm: 'claude', name: 'Total', feature: 'checkout' }));
  assert.equal(filled.result.status, 'filled');
  assert.equal(filled.calls.length, 1);
  assert.equal(fs.readFileSync(file, 'utf8'), 'export function Total(xs: number[]): number {\n  return xs.reduce((s, x) => s + x, 0);\n}');
  // auto-fix: a fake validator flags line 2 until the body has no "0"; each retry sees only the current violation.
  const rel = 'features/checkout/domain/Total.ts';
  fs.writeFileSync(file, 'export function Total(xs: number[]): number {\n  return 0;\n}\n');
  const validate = () => ({ violations: /return 0/.test(fs.readFileSync(file, 'utf8')) || /return 1/.test(fs.readFileSync(file, 'utf8')) ? [{ file: rel, rule: 'X-1', line: 2, message: 'no literal return', severity: 'error' }] : [] });
  const fixed = await withFake((n) => (n === 1 ? '  return 1;\n}' : '  return xs.length;\n}'), () => autoFixViolations(root, [rel], validate, { llm: 'claude' }));
  assert.deepEqual(fixed.result.fixed, [{ file: rel, attempts: 2 }]);
  assert.ok(!fixed.calls[1].prompt.includes('EARLIER ATTEMPTS'), 'no growing history');
  assert.equal(fixed.calls[1].options.output.prefill, 'export function Total(xs: number[]): number {\n');
});
