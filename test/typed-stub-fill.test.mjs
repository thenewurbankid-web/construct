// #777 -- `--typed` seeds a `--llm` fill's "current stub" from the layer's typed-contract factory
// (packages/core/typed-contracts/factories.ts) instead of generators.mjs's bare template, so "does a
// typed shape help the model" is a real, repeatable CLI command instead of a hand-built harness (see
// #526's rerun, which had to hand-vendor typed-contracts into a throwaway project to test this at all).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createFeature, generateTypedLayer, TYPED_STUB_LAYERS } from '../packages/core/generators.mjs';
import { generate } from '../packages/core/cli.mjs';
import { PROVIDERS } from '../packages/core/llm.mjs';
import { ConstructError } from '../packages/core/diagnostics.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const tmp = () => makeTempDir('construct-typed-stub-');

async function withFake(responses, fn) {
  const original = PROVIDERS.claude;
  const calls = [];
  PROVIDERS.claude = (prompt) => {
    calls.push(prompt);
    const r = typeof responses === 'function' ? responses(calls.length) : responses[Math.min(calls.length, responses.length) - 1];
    if (r instanceof Error) throw r;
    return r;
  };
  try {
    return { result: await fn(), calls };
  } finally {
    PROVIDERS.claude = original;
  }
}

async function captureConsole(fn) {
  const lines = [];
  const orig = console.log;
  console.log = (...p) => lines.push(p.join(' '));
  const priorExit = process.exitCode;
  process.exitCode = undefined;
  try {
    await fn();
  } finally {
    console.log = orig;
  }
  const exitCode = process.exitCode;
  process.exitCode = priorExit;
  return { out: lines.join('\n'), exitCode };
}

const PROSE = "I wasn't able to write directly to the file, so here is the content, please apply it manually:";

test('TYPED_STUB_LAYERS has a factory stub for domain/service/workflow/component/page/controller -- not hook, route, expression (already typed by construction), adapter or viewmodel (no factory of their own)', () => {
  assert.deepEqual(
    [...TYPED_STUB_LAYERS].sort(),
    ['component', 'controller', 'domain', 'page', 'service', 'workflow'].sort(),
  );
});

test('generateTypedLayer writes a defineDomain-shaped stub (not the bare "export function" one)', () => {
  const dir = tmp();
  createFeature(dir, 'checkout');
  const file = generateTypedLayer(dir, 'domain', 'Foo', 'checkout');
  const content = fs.readFileSync(file, 'utf8');
  assert.match(content, /import \{ defineDomain \} from '@line\/construct-core\/typed-contracts';/);
  assert.match(content, /export const Foo = defineDomain</);
  assert.doesNotMatch(content, /export function Foo/);
});

test('generateTypedLayer throws for a layer with no typed-contract factory (hook)', () => {
  const dir = tmp();
  createFeature(dir, 'checkout');
  assert.throws(() => generateTypedLayer(dir, 'hook', 'Foo', 'checkout'), /No typed-contract factory stub for layer: hook/);
});

// ---- CLI: single-layer `generate <layer> <name> --feature f --llm <provider> --typed` ----

test('generate --llm --typed rejects a rejected fill and leaves the TYPED stub (not the bare one) on disk', async () => {
  const dir = tmp();
  createFeature(dir, 'checkout');
  const { result } = await withFake([PROSE], () =>
    captureConsole(() => generate(['domain', 'Foo', '--feature', 'checkout', '--llm', 'claude', '--typed', '--dir', dir])),
  );
  assert.match(result.out, /stub kept — the model's output was rejected/);
  const content = fs.readFileSync(path.join(dir, 'features/checkout/domain/Foo.ts'), 'utf8');
  assert.match(content, /defineDomain</);
});

test('generate --llm --typed: a clean fill overwrites the typed stub with the model output, same as the bare path', async () => {
  const dir = tmp();
  createFeature(dir, 'checkout');
  const CODE = "import { defineDomain } from '@line/construct-core/typed-contracts';\n\nexport const Foo = defineDomain('Foo', () => 7 > 0);\n";
  const { result } = await withFake([CODE], () =>
    captureConsole(() => generate(['domain', 'Foo', '--feature', 'checkout', '--llm', 'claude', '--typed', '--dir', dir])),
  );
  assert.match(result.out, /LLM-filled/);
  assert.equal(fs.readFileSync(path.join(dir, 'features/checkout/domain/Foo.ts'), 'utf8').trim(), CODE.trim());
});

test('generate --typed without --llm is a usage error -- it only seeds a fill, it never writes real code on its own', async () => {
  const dir = tmp();
  createFeature(dir, 'checkout');
  await assert.rejects(
    () => generate(['domain', 'Foo', '--feature', 'checkout', '--typed', '--dir', dir]),
    (e) => e instanceof ConstructError && /only seeds the stub for a --llm fill/.test(e.message),
  );
});

test('generate --llm --typed for the expression layer: already typed by construction, no "fallback" note, and fills normally', async () => {
  const dir = tmp();
  createFeature(dir, 'checkout');
  const { result } = await withFake([PROSE], () =>
    captureConsole(() => generate(['expression', 'ByStatus', '--feature', 'checkout', '--llm', 'claude', '--typed', '--dir', dir])),
  );
  assert.doesNotMatch(result.out, /Unknown layer/);
  assert.doesNotMatch(result.out, /Note: no typed-contract factory stub/);
  assert.match(fs.readFileSync(path.join(dir, 'features/checkout/expressions/ByStatus.tsx'), 'utf8'), /defineExpression/);
});

test('generate --llm --typed for hook (no factory) falls back to the bare stub with a note, and still fills it', async () => {
  const dir = tmp();
  createFeature(dir, 'checkout');
  const { result } = await withFake([PROSE], () =>
    captureConsole(() => generate(['hook', 'Foo', '--feature', 'checkout', '--llm', 'claude', '--typed', '--dir', dir])),
  );
  assert.match(result.out, /Note: no typed-contract factory stub for layer "hook" yet — scaffolded the bare template instead\./);
  assert.match(fs.readFileSync(path.join(dir, 'features/checkout/hooks/useFoo.tsx'), 'utf8'), /export function useFoo/);
});

// ---- CLI: vertical slice `generate layer <name> --feature f --layers l1,l2 --llm <provider> --typed` ----

test('generate layer --llm --typed seeds every requested layer from its typed factory, one note per unsupported layer', async () => {
  const dir = tmp();
  const { result } = await withFake([PROSE], () =>
    captureConsole(() => generate(['layer', 'Foo', '--feature', 'checkout', '--layers', 'domain,hook', '--llm', 'claude', '--typed', '--dir', dir])),
  );
  assert.match(result.out, /Note: no typed-contract factory stub for layer "hook" yet/);
  assert.match(fs.readFileSync(path.join(dir, 'features/checkout/domain/Foo.ts'), 'utf8'), /defineDomain</);
  assert.match(fs.readFileSync(path.join(dir, 'features/checkout/hooks/useFoo.tsx'), 'utf8'), /export function useFoo/);
});

test('generate layer --typed without --llm is a usage error', async () => {
  const dir = tmp();
  await assert.rejects(
    () => generate(['layer', 'Foo', '--feature', 'checkout', '--layers', 'domain', '--typed', '--dir', dir]),
    (e) => e instanceof ConstructError && /only seeds the stub for a --llm fill/.test(e.message),
  );
});
