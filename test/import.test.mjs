import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createFeature } from '../src/generators.mjs';
import { importVertical, importPlan, analyzeRoute } from '../src/import.mjs';
import { PROVIDERS } from '../src/llm.mjs';
import { validateArchitecture } from '../src/architecture-enforcer.mjs';
import { ConstructError } from '../src/diagnostics.mjs';

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'construct-import-'));
}

/** Swap in a fake provider for the duration of `fn`, restoring the real one
 * afterward even if `fn` throws — none of these tests should ever shell out
 * to a real LLM CLI. */
function withFakeClaude(fn) {
  const original = PROVIDERS.claude;
  const calls = [];
  PROVIDERS.claude = (prompt) => {
    calls.push(prompt);
    return '```ts\nexport function Ported() { return true; }\n```';
  };
  try {
    return { result: fn(), calls };
  } finally {
    PROVIDERS.claude = original;
  }
}

test('importVertical scaffolds every requested layer and prepends a breadcrumb to each', () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-import-src-'));
  const sourceFile = path.join(sourceDir, 'OldGate.tsx');
  fs.writeFileSync(sourceFile, `export function useOldGate() { return true; }\n`);

  const result = importVertical(dir, 'CpoAccess', 'checkout', ['domain', 'hook'], sourceFile);
  assert.equal(result.source, sourceFile);
  assert.equal(result.files.length, 2);

  for (const file of result.files) {
    const content = fs.readFileSync(file, 'utf8');
    assert.match(content, /TODO\(import\): port the relevant logic from .*OldGate\.tsx into this file\./);
  }

  const res = validateArchitecture(dir);
  assert.equal(res.violations.some((v) => v.rule === 'IMPORT-001'), false);
});

test('importVertical never reads the source file\'s content, only confirms it exists', () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const sourceFile = path.join(tmpProject(), 'HasBannedWord.tsx');
  // If this were read into a domain file's body (not just a comment), it
  // would trip DOMAIN-001 (banned effect words) — importVertical must not
  // do that; only the file's own PATH goes into the breadcrumb comment.
  fs.writeFileSync(sourceFile, `export function old() { return fetch('/x'); }\n`);
  const result = importVertical(dir, 'Foo', 'checkout', ['domain'], sourceFile);
  const res = validateArchitecture(dir, { files: [path.relative(dir, result.files[0])] });
  assert.equal(res.violations.some((v) => v.rule === 'DOMAIN-001'), false);
});

test('importVertical throws if the source file does not exist', () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  assert.throws(() => importVertical(dir, 'Foo', 'checkout', ['domain'], path.join(dir, 'nope.tsx')), ConstructError);
});

test('importVertical throws if --from points at a directory, not a file', () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  assert.throws(() => importVertical(dir, 'Foo', 'checkout', ['domain'], dir), ConstructError);
});

// ---- importPlan: batch execution of an approved plan -----------------------

function writePlan(dir, plan) {
  const planPath = path.join(dir, 'plan.json');
  fs.writeFileSync(planPath, JSON.stringify(plan));
  return planPath;
}

test('importPlan executes every unit in order and reports each result', () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-import-src-'));
  const gate = path.join(srcDir, 'OldGate.ts');
  const greeting = path.join(srcDir, 'OldGreeting.ts');
  fs.writeFileSync(gate, 'export function useGate() { return true; }\n');
  fs.writeFileSync(greeting, 'export function greet() { return "hi"; }\n');

  const planPath = writePlan(dir, {
    feature: 'checkout',
    units: [
      { name: 'CpoAccess', layers: ['domain', 'hook'], from: gate },
      { name: 'CpoGreeting', layers: ['domain'], from: greeting },
    ],
  });

  const { feature, results } = importPlan(dir, planPath);
  assert.equal(feature, 'checkout');
  assert.equal(results.length, 2);
  assert.equal(results[0].files.length, 2);
  assert.equal(results[1].files.length, 1);
  assert.equal(fs.existsSync(path.join(dir, 'features', 'checkout', 'domain', 'CpoAccess.tsx')), true);
  assert.equal(fs.existsSync(path.join(dir, 'features', 'checkout', 'hooks', 'useCpoAccess.tsx')), true);
  assert.equal(fs.existsSync(path.join(dir, 'features', 'checkout', 'domain', 'CpoGreeting.tsx')), true);

  const res = validateArchitecture(dir);
  assert.equal(res.violations.some((v) => v.rule === 'IMPORT-001'), false);
});

test('importPlan throws on a malformed plan (missing feature/units)', () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const planPath = writePlan(dir, { units: [] });
  assert.throws(() => importPlan(dir, planPath), ConstructError);
});

test('importPlan throws on an invalid unit (missing layers)', () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const planPath = writePlan(dir, { feature: 'checkout', units: [{ name: 'Foo', from: 'x.ts' }] });
  assert.throws(() => importPlan(dir, planPath), ConstructError);
});

test('importPlan throws with a clear message on unparseable JSON', () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const planPath = path.join(dir, 'bad-plan.json');
  fs.writeFileSync(planPath, '{ not valid json');
  assert.throws(() => importPlan(dir, planPath), ConstructError);
});

// ---- { llm } option: the one place import calls an LLM, and only when asked ----

test('importVertical with no llm option never touches PROVIDERS.claude', () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const sourceFile = path.join(dir, 'Old.tsx');
  fs.writeFileSync(sourceFile, 'export function old() { return true; }\n');
  let called = false;
  const original = PROVIDERS.claude;
  PROVIDERS.claude = () => { called = true; return 'x'; };
  try {
    const { llmFilled } = importVertical(dir, 'Foo', 'checkout', ['domain'], sourceFile);
    assert.equal(llmFilled, false);
    assert.equal(called, false);
  } finally {
    PROVIDERS.claude = original;
  }
});

test('importVertical with { llm: "claude" } calls the provider once per generated file and strips code fences', () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const sourceFile = path.join(dir, 'Old.tsx');
  fs.writeFileSync(sourceFile, 'export function useOld() { return 42; }\n');

  const { result, calls } = withFakeClaude(() => importVertical(dir, 'Foo', 'checkout', ['domain', 'hook'], sourceFile, { llm: 'claude' }));

  assert.equal(result.llmFilled, true);
  assert.equal(result.files.length, 2);
  assert.equal(calls.length, 2, 'one call per generated file, not one for the whole batch');

  const domainContent = fs.readFileSync(path.join(dir, 'features', 'checkout', 'domain', 'Foo.tsx'), 'utf8');
  assert.equal(domainContent.trim(), 'export function Ported() { return true; }');
  assert.doesNotMatch(domainContent, /```/, 'code fence must be stripped');
  assert.doesNotMatch(domainContent, /TODO\(import\)/, 'no breadcrumb when llm-filled');

  // The prompt sent for the domain file should carry that file's own layer
  // constraint, not the hook's.
  const domainPrompt = calls.find((c) => c.includes('domain/Foo.tsx'));
  assert.match(domainPrompt, /Never write the words fetch, window, document/);
});

test('importVertical with { llm } threads through importPlan for every unit', () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const sourceFile = path.join(dir, 'Old.tsx');
  fs.writeFileSync(sourceFile, 'export function old() { return true; }\n');
  const planPath = writePlan(dir, { feature: 'checkout', units: [{ name: 'Foo', layers: ['domain'], from: sourceFile }] });

  const { calls } = withFakeClaude(() => importPlan(dir, planPath, { llm: 'claude' }));
  assert.equal(calls.length, 1);
});

// ---- analyzeRoute: excludes test files from the analysis -------------------

test('analyzeRoute excludes .test./.spec. files from the analysis prompt', () => {
  const routeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-import-route-'));
  fs.writeFileSync(path.join(routeDir, 'useCpoGate.ts'), 'export function useCpoGate() { return true; }\n');
  fs.writeFileSync(path.join(routeDir, 'useCpoGate.test.ts'), 'test("gate", () => {});\n');
  fs.writeFileSync(path.join(routeDir, 'Foo.spec.tsx'), 'test("foo", () => {});\n');

  const original = PROVIDERS.claude;
  let seenPrompt = '';
  PROVIDERS.claude = (prompt) => {
    seenPrompt = prompt;
    return JSON.stringify({ feature: 'checkout', units: [{ name: 'CpoGate', layers: ['hook'], from: 'useCpoGate.ts' }] });
  };
  try {
    analyzeRoute(routeDir, 'checkout');
  } finally {
    PROVIDERS.claude = original;
  }

  assert.match(seenPrompt, /useCpoGate\.ts/);
  assert.doesNotMatch(seenPrompt, /useCpoGate\.test\.ts/);
  assert.doesNotMatch(seenPrompt, /Foo\.spec\.tsx/);
});

test('analyzeRoute warns (does not silently drop) when a file is too large for the analysis budget', () => {
  const routeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-import-route-'));
  // Comfortably smaller real features (CPO v2's 15 files are ~189k chars
  // total) must fit with no warning at all — only something genuinely
  // over the budget should trigger one.
  fs.writeFileSync(path.join(routeDir, 'Huge.ts'), `export function huge() { return "${'x'.repeat(600000)}"; }\n`);

  const originalWarn = console.warn;
  const originalClaude = PROVIDERS.claude;
  const warnings = [];
  console.warn = (msg) => warnings.push(msg);
  PROVIDERS.claude = () => JSON.stringify({ feature: 'checkout', units: [{ name: 'Huge', layers: ['domain'], from: 'Huge.ts' }] });
  try {
    analyzeRoute(routeDir, 'checkout');
  } finally {
    console.warn = originalWarn;
    PROVIDERS.claude = originalClaude;
  }

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Huge\.ts/);
});

test('analyzeRoute does not warn for a realistically-sized multi-file feature', () => {
  const routeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-import-route-'));
  // A handful of ~5k-char files — nowhere near the 500k budget.
  for (let i = 0; i < 5; i++) {
    fs.writeFileSync(path.join(routeDir, `File${i}.ts`), `export function f${i}() { return "${'x'.repeat(5000)}"; }\n`);
  }

  const originalWarn = console.warn;
  const originalClaude = PROVIDERS.claude;
  const warnings = [];
  console.warn = (msg) => warnings.push(msg);
  PROVIDERS.claude = () => JSON.stringify({ feature: 'checkout', units: [{ name: 'File0', layers: ['domain'], from: 'File0.ts' }] });
  try {
    analyzeRoute(routeDir, 'checkout');
  } finally {
    console.warn = originalWarn;
    PROVIDERS.claude = originalClaude;
  }

  assert.equal(warnings.length, 0);
});
