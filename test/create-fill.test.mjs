// #101/Epic 6.5 — optional local-model fill step for construct create/
// generate. Mirrors test/import.test.mjs's shape: a fake PROVIDERS.claude
// stands in for a real LLM call so nothing here ever shells out/makes a
// real network call.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFeature, generateLayer, fillGeneratedFile, LAYER_CONSTRAINTS } from '../src/generators.mjs';
import { create, generate } from '../src/cli.mjs';
import { PROVIDERS } from '../src/llm.mjs';

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'construct-create-fill-'));
}

async function withFakeClaude(response, fn) {
  const original = PROVIDERS.claude;
  const calls = [];
  PROVIDERS.claude = (prompt) => {
    calls.push(prompt);
    return typeof response === 'function' ? response(calls.length) : response;
  };
  try {
    return { result: await fn(), calls };
  } finally {
    PROVIDERS.claude = original;
  }
}

// ---- generators.mjs's fillGeneratedFile — the low-level building block ---

test('fillGeneratedFile overwrites the stub with the provider\'s (code-fence-stripped) response', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const file = generateLayer(dir, 'domain', 'Foo', 'checkout');
  const stubBefore = fs.readFileSync(file, 'utf8');

  const { calls } = await withFakeClaude('```ts\nexport function Foo() { return 42; }\n```', () =>
    fillGeneratedFile(dir, file, 'domain', { feature: 'checkout', name: 'Foo', llm: 'claude' }),
  );

  assert.equal(calls.length, 1);
  const after = fs.readFileSync(file, 'utf8');
  assert.equal(after.trim(), 'export function Foo() { return 42; }');
  assert.notEqual(after, stubBefore);
  assert.doesNotMatch(after, /```/);
});

test('fillGeneratedFile\'s prompt carries the target layer\'s own constraint text and the stub for the model to rewrite', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const file = generateLayer(dir, 'domain', 'Foo', 'checkout');
  const stubContent = fs.readFileSync(file, 'utf8');

  const { calls } = await withFakeClaude('export function Foo() { return true; }', () =>
    fillGeneratedFile(dir, file, 'domain', { feature: 'checkout', name: 'Foo', llm: 'claude' }),
  );

  assert.match(calls[0], new RegExp(LAYER_CONSTRAINTS.domain.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(calls[0], /feature: "checkout"/);
  assert.match(calls[0], /"Foo"/);
  assert.ok(calls[0].includes(stubContent), 'prompt must include the actual stub content to rewrite');
});

// ---- cli.mjs's generate()/create() --llm wiring ---------------------------

test('generate <layer> <name> --feature f with no --llm leaves the plain template stub untouched (default unchanged)', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  await generate(['domain', 'Foo', '--feature', 'checkout', '--dir', dir]);
  const content = fs.readFileSync(path.join(dir, 'features', 'checkout', 'domain', 'Foo.tsx'), 'utf8');
  assert.equal(content, `export function Foo() {\n  return true;\n}\n`);
});

test('generate <layer> <name> --feature f --llm claude calls the provider once and writes its output', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const { calls } = await withFakeClaude('export function Foo() { return 99; }', () =>
    generate(['domain', 'Foo', '--feature', 'checkout', '--dir', dir, '--llm', 'claude']),
  );
  assert.equal(calls.length, 1);
  const content = fs.readFileSync(path.join(dir, 'features', 'checkout', 'domain', 'Foo.tsx'), 'utf8');
  assert.equal(content.trim(), 'export function Foo() { return 99; }');
});

test('generate layer <name> --feature f --layers a,b with no --llm scaffolds every layer\'s plain stub, zero LLM calls', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  let called = false;
  const original = PROVIDERS.claude;
  PROVIDERS.claude = () => { called = true; return 'x'; };
  try {
    await generate(['layer', 'Foo', '--feature', 'checkout', '--layers', 'domain,hook', '--dir', dir]);
  } finally {
    PROVIDERS.claude = original;
  }
  assert.equal(called, false);
  assert.equal(fs.readFileSync(path.join(dir, 'features', 'checkout', 'domain', 'Foo.tsx'), 'utf8'), `export function Foo() {\n  return true;\n}\n`);
  assert.match(fs.readFileSync(path.join(dir, 'features', 'checkout', 'hooks', 'useFoo.tsx'), 'utf8'), /export function useFoo/);
});

test('generate layer <name> --feature f --layers a,b --llm claude fills every generated file, one call each, with its own layer\'s constraint', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const { calls } = await withFakeClaude(
    (callNumber) => (callNumber === 1 ? 'export function Foo() { return 1; }' : 'export function useFoo() { return 2; }'),
    () => generate(['layer', 'Foo', '--feature', 'checkout', '--layers', 'domain,hook', '--dir', dir, '--llm', 'claude']),
  );
  assert.equal(calls.length, 2, 'one call per generated file');
  const domainPrompt = calls.find((c) => c.includes('domain/Foo.tsx'));
  const hookPrompt = calls.find((c) => c.includes('hooks/useFoo.tsx'));
  assert.match(domainPrompt, /Never write the words fetch, window, document/);
  assert.match(hookPrompt, /the exported function name must start with "use"/);

  assert.equal(fs.readFileSync(path.join(dir, 'features', 'checkout', 'domain', 'Foo.tsx'), 'utf8').trim(), 'export function Foo() { return 1; }');
  assert.equal(fs.readFileSync(path.join(dir, 'features', 'checkout', 'hooks', 'useFoo.tsx'), 'utf8').trim(), 'export function useFoo() { return 2; }');
});

// ---- create() — scoped strictly to filling ONE file, never deciding layers/shape ----

test('create <layer> <name> --feature f --llm claude fills the file and reports LLM attribution', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const logs = [];
  const originalLog = console.log;
  console.log = (...parts) => logs.push(parts.join(' '));
  try {
    await withFakeClaude('export function Foo() { return 7; }', () =>
      create(['domain', 'Foo', '--feature', 'checkout', '--dir', dir, '--llm', 'claude']),
    );
  } finally {
    console.log = originalLog;
  }
  const attributionLine = logs.find((l) => l.startsWith('[tool:'));
  assert.ok(attributionLine, 'must print a [tool:...] [llm:...] attribution line');
  assert.match(attributionLine, /\[llm: call\(s\) via "claude" to write the real implementation/);
  assert.equal(fs.readFileSync(path.join(dir, 'features', 'checkout', 'domain', 'Foo.tsx'), 'utf8').trim(), 'export function Foo() { return 7; }');
});

test('create feature <name> ignores any --llm (nothing fillable) and reports 0 calls', async () => {
  const dir = tmpProject();
  const logs = [];
  const originalLog = console.log;
  console.log = (...parts) => logs.push(parts.join(' '));
  let called = false;
  const original = PROVIDERS.claude;
  PROVIDERS.claude = () => { called = true; return 'x'; };
  try {
    await create(['feature', 'checkout', '--dir', dir, '--llm', 'claude']);
  } finally {
    console.log = originalLog;
    PROVIDERS.claude = original;
  }
  assert.equal(called, false);
  const attributionLine = logs.find((l) => l.startsWith('[tool:'));
  assert.match(attributionLine, /\[llm: 0 calls/);
});

test('create <layer> <name> --feature f with no --llm scaffolds the plain stub, byte-for-byte identical to before this feature existed', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  await create(['domain', 'Foo', '--feature', 'checkout', '--dir', dir]);
  assert.equal(fs.readFileSync(path.join(dir, 'features', 'checkout', 'domain', 'Foo.tsx'), 'utf8'), `export function Foo() {\n  return true;\n}\n`);
});
