// #109: the import --route wizard reads per-capability providers
// (planAnalysis for the one analysis call, importFill for per-file fills)
// instead of a hardcoded 'claude'. Providers are faked; no real LLM is called.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { importRouteWizard } from '../packages/core/cli.mjs';
import { createFeature } from '../packages/core/generators.mjs';
import { PROVIDERS } from '../packages/core/llm.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const tmpProject = () => makeTempDir('construct-wizard-prov-');
const scriptedAsk = (answers) => {
  const queue = [...answers];
  return async () => queue.shift() ?? '';
};

async function inProject(dir, fn) {
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    await fn();
  } finally {
    process.chdir(originalCwd);
  }
}

function routeFixture() {
  const dir = makeTempDir('construct-wizard-prov-route-');
  fs.writeFileSync(path.join(dir, 'page.tsx'), 'import x0 from "./Old";\nexport default function Page() { return null; }\n');
  fs.writeFileSync(path.join(dir, 'Old.ts'), 'export function old() { return true; }\n');
  return dir;
}

test('#109 wizard uses the planAnalysis provider for analysis and the importFill provider for the per-file fill', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const routeDir = routeFixture();
  const planJson = JSON.stringify({ feature: 'checkout', units: [{ name: 'Foo', layers: ['domain'], from: 'Old.ts' }] });

  const originalClaude = PROVIDERS.claude;
  const originalOllama = PROVIDERS.ollama;
  const claudeCalls = [];
  const ollamaCalls = [];
  PROVIDERS.claude = (p) => { claudeCalls.push(p); return planJson; };
  PROVIDERS.ollama = async (p) => { ollamaCalls.push(p); return 'export function Foo() { return 5; }'; };
  try {
    await inProject(dir, () => importRouteWizard(scriptedAsk(['checkout', '', 'y', 'y']), routeDir, { planAnalysis: 'claude', importFill: 'ollama' }));
  } finally {
    PROVIDERS.claude = originalClaude;
    PROVIDERS.ollama = originalOllama;
  }
  assert.equal(claudeCalls.length, 1, 'analysis went to claude');
  assert.equal(ollamaCalls.length, 1, 'the per-file fill went to the importFill provider');
  assert.match(fs.readFileSync(path.join(dir, 'features/checkout/domain/Foo.tsx'), 'utf8'), /return 5/);
});

test('#109 wizard still hard-rejects ollama for plan analysis: no call, nothing written', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const routeDir = routeFixture();
  const originalOllama = PROVIDERS.ollama;
  let called = false;
  PROVIDERS.ollama = async () => { called = true; return '{}'; };
  const errors = [];
  const origErr = console.error;
  console.error = (...a) => errors.push(a.join(' '));
  try {
    await inProject(dir, () => importRouteWizard(scriptedAsk(['checkout', '', 'n', 'y']), routeDir, { planAnalysis: 'ollama' }));
  } finally {
    console.error = origErr;
    PROVIDERS.ollama = originalOllama;
  }
  assert.equal(called, false);
  assert.match(errors.join('\n'), /cannot use "ollama"/);
  assert.equal(fs.existsSync(path.join(dir, 'features/checkout/domain/Foo.tsx')), false);
});
