import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createFeature } from '../packages/core/generators.mjs';
import { importVertical, importPlan, analyzeRoute, validatePlanShape, normalizePlanLayers } from '../packages/core/import.mjs';
import { PROVIDERS } from '../packages/core/llm.mjs';
import { validateArchitecture } from '../packages/core/architecture-enforcer.mjs';
import { ConstructError } from '../packages/core/diagnostics.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

function tmpProject() {
  return makeTempDir('construct-import-');
}

/** Swap in a fake provider for the duration of `fn`, restoring the real one
 * afterward even if `fn` throws — none of these tests should ever shell out
 * to a real LLM CLI. `fn` may be async (callLlm always awaits its result). */
async function withFakeClaude(fn) {
  const original = PROVIDERS.claude;
  const calls = [];
  PROVIDERS.claude = (prompt) => {
    calls.push(prompt);
    return '```ts\nexport function Ported() { return true; }\n```';
  };
  try {
    return { result: await fn(), calls };
  } finally {
    PROVIDERS.claude = original;
  }
}

test('importVertical scaffolds every requested layer and prepends a breadcrumb to each', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const sourceDir = makeTempDir('construct-import-src-');
  const sourceFile = path.join(sourceDir, 'OldGate.tsx');
  fs.writeFileSync(sourceFile, `export function useOldGate() { return true; }\n`);

  const result = await importVertical(dir, 'CpoAccess', 'checkout', ['domain', 'hook'], sourceFile);
  assert.equal(result.source, sourceFile);
  assert.equal(result.files.length, 2);

  for (const file of result.files) {
    const content = fs.readFileSync(file, 'utf8');
    assert.match(content, /TODO\(import\): port the relevant logic from .*OldGate\.tsx into this file\./);
  }

  const res = validateArchitecture(dir);
  assert.equal(res.violations.some((v) => v.rule === 'IMPORT-001'), false);
});

test('importVertical never reads the source file\'s content, only confirms it exists', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const sourceFile = path.join(tmpProject(), 'HasBannedWord.tsx');
  // If this were read into a domain file's body (not just a comment), it
  // would trip DOMAIN-001 (banned effect words) — importVertical must not
  // do that; only the file's own PATH goes into the breadcrumb comment.
  fs.writeFileSync(sourceFile, `export function old() { return fetch('/x'); }\n`);
  const result = await importVertical(dir, 'Foo', 'checkout', ['domain'], sourceFile);
  const res = validateArchitecture(dir, { files: [path.relative(dir, result.files[0])] });
  assert.equal(res.violations.some((v) => v.rule === 'DOMAIN-001'), false);
});

test('importVertical throws if the source file does not exist', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  await assert.rejects(() => importVertical(dir, 'Foo', 'checkout', ['domain'], path.join(dir, 'nope.tsx')), ConstructError);
});

// #519 (dogfood-surfaced): re-running import for the same name/feature/layer
// used to silently overwrite whatever was already there — including a
// human's finished hand-port or an earlier LLM fill — because
// generateVertical's write() has no existence check of its own.
test('importVertical refuses to overwrite a target file that already has real (non-stub) content', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const sourceFile = path.join(tmpProject(), 'Old.tsx');
  fs.writeFileSync(sourceFile, `export function old() { return true; }\n`);

  const { files } = await importVertical(dir, 'Foo', 'checkout', ['domain'], sourceFile);
  // Simulate a human finishing the port: real content, no TODO(import) marker left.
  fs.writeFileSync(files[0], `export function Foo() { return 42; }\n`);
  const before = fs.readFileSync(files[0], 'utf8');

  await assert.rejects(
    () => importVertical(dir, 'Foo', 'checkout', ['domain'], sourceFile),
    (e) => e instanceof ConstructError && /already exist with real content/.test(e.message) && e.message.includes('domain/Foo.tsx'),
  );
  assert.equal(fs.readFileSync(files[0], 'utf8'), before, 'the hand-ported file must be left untouched');
});

test('importVertical still allows re-running over a target file that is still just an unfilled import stub', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const sourceFile = path.join(tmpProject(), 'Old.tsx');
  fs.writeFileSync(sourceFile, `export function old() { return true; }\n`);

  await importVertical(dir, 'Foo', 'checkout', ['domain'], sourceFile);
  // No edits — the stub + TODO(import) breadcrumb is still exactly what was written.
  await assert.doesNotReject(() => importVertical(dir, 'Foo', 'checkout', ['domain'], sourceFile));
});

test('importVertical throws if --from points at a directory, not a file', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  await assert.rejects(() => importVertical(dir, 'Foo', 'checkout', ['domain'], dir), ConstructError);
});

// ---- importPlan: batch execution of an approved plan -----------------------

function writePlan(dir, plan) {
  const planPath = path.join(dir, 'plan.json');
  fs.writeFileSync(planPath, JSON.stringify(plan));
  return planPath;
}

test('importPlan executes every unit in order and reports each result', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const srcDir = makeTempDir('construct-import-src-');
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

  const { feature, results } = await importPlan(dir, planPath);
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

test('importPlan throws on a malformed plan (missing feature/units)', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const planPath = writePlan(dir, { units: [] });
  await assert.rejects(() => importPlan(dir, planPath), ConstructError);
});

test('importPlan throws on an invalid unit (missing layers)', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const planPath = writePlan(dir, { feature: 'checkout', units: [{ name: 'Foo', from: 'x.ts' }] });
  await assert.rejects(() => importPlan(dir, planPath), ConstructError);
});

test('importPlan throws with a clear message on unparseable JSON', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const planPath = path.join(dir, 'bad-plan.json');
  fs.writeFileSync(planPath, '{ not valid json');
  await assert.rejects(() => importPlan(dir, planPath), ConstructError);
});

// ---- { llm } option: the one place import calls an LLM, and only when asked ----

test('importVertical with no llm option never touches PROVIDERS.claude', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const sourceFile = path.join(dir, 'Old.tsx');
  fs.writeFileSync(sourceFile, 'export function old() { return true; }\n');
  let called = false;
  const original = PROVIDERS.claude;
  PROVIDERS.claude = () => { called = true; return 'x'; };
  try {
    const { llmFilled } = await importVertical(dir, 'Foo', 'checkout', ['domain'], sourceFile);
    assert.equal(llmFilled, false);
    assert.equal(called, false);
  } finally {
    PROVIDERS.claude = original;
  }
});

test('importVertical with { llm: "claude" } calls the provider once per generated file and strips code fences', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const sourceFile = path.join(dir, 'Old.tsx');
  fs.writeFileSync(sourceFile, 'export function useOld() { return 42; }\n');

  const { result, calls } = await withFakeClaude(() => importVertical(dir, 'Foo', 'checkout', ['domain', 'hook'], sourceFile, { llm: 'claude' }));

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

test('importVertical with { llm } threads through importPlan for every unit', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const sourceFile = path.join(dir, 'Old.tsx');
  fs.writeFileSync(sourceFile, 'export function old() { return true; }\n');
  const planPath = writePlan(dir, { feature: 'checkout', units: [{ name: 'Foo', layers: ['domain'], from: sourceFile }] });

  const { calls } = await withFakeClaude(() => importPlan(dir, planPath, { llm: 'claude' }));
  assert.equal(calls.length, 1);
});

// ---- analyzeRoute: excludes test files from the analysis -------------------

test('analyzeRoute excludes .test./.spec. files from the analysis prompt', async () => {
  const routeDir = makeTempDir('construct-import-route-');
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
    await analyzeRoute(routeDir, 'checkout');
  } finally {
    PROVIDERS.claude = original;
  }

  assert.match(seenPrompt, /useCpoGate\.ts/);
  assert.doesNotMatch(seenPrompt, /useCpoGate\.test\.ts/);
  assert.doesNotMatch(seenPrompt, /Foo\.spec\.tsx/);
});

test('analyzeRoute warns (does not silently drop) when a file is too large for the analysis budget', async () => {
  const routeDir = makeTempDir('construct-import-route-');
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
    await analyzeRoute(routeDir, 'checkout');
  } finally {
    console.warn = originalWarn;
    PROVIDERS.claude = originalClaude;
  }

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Huge\.ts/);
});

test('analyzeRoute does not warn for a realistically-sized multi-file feature', async () => {
  const routeDir = makeTempDir('construct-import-route-');
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
    await analyzeRoute(routeDir, 'checkout');
  } finally {
    console.warn = originalWarn;
    PROVIDERS.claude = originalClaude;
  }

  assert.equal(warnings.length, 0);
});

// ---- ollama as a real end-to-end fill provider (not just llm.mjs's own
// unit tests) — confirms import.mjs's async plumbing actually threads a
// non-claude provider through correctly.

// ---- timing (#166): non-negative, present, never asserted at an exact value ----

test('importVertical returns a timings object with non-negative scaffold/per-file/total seconds', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const sourceFile = path.join(dir, 'Old.tsx');
  fs.writeFileSync(sourceFile, 'export function old() { return true; }\n');

  const result = await importVertical(dir, 'Foo', 'checkout', ['domain', 'hook'], sourceFile);
  assert.ok(result.timings, 'expected a timings object on the result');
  assert.equal(typeof result.timings.scaffoldSeconds, 'number');
  assert.ok(result.timings.scaffoldSeconds >= 0);
  assert.equal(typeof result.timings.totalSeconds, 'number');
  assert.ok(result.timings.totalSeconds >= 0);
  assert.equal(result.timings.files.length, 2);
  for (const f of result.timings.files) {
    assert.equal(typeof f.llmSeconds, 'number');
    assert.ok(f.llmSeconds >= 0);
    assert.ok(result.files.includes(f.file));
  }
  // No llm option: nothing to distinguish an LLM-fill step from a trivial
  // breadcrumb write, so each file's own llmSeconds is exactly 0 (not just
  // "some small number") -- that's the documented no-llm contract.
  assert.ok(result.timings.files.every((f) => f.llmSeconds === 0));
});

test('importVertical with { llm } reports a non-zero-shaped (still non-negative) llmSeconds per file', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const sourceFile = path.join(dir, 'Old.tsx');
  fs.writeFileSync(sourceFile, 'export function useOld() { return 42; }\n');

  const { result } = await withFakeClaude(() => importVertical(dir, 'Foo', 'checkout', ['domain'], sourceFile, { llm: 'claude' }));
  assert.equal(result.timings.files.length, 1);
  assert.equal(typeof result.timings.files[0].llmSeconds, 'number');
  assert.ok(result.timings.files[0].llmSeconds >= 0);
});

test('executeImportPlan/importPlan thread a timings object through every unit\'s result', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const srcDir = makeTempDir('construct-import-src-');
  const gate = path.join(srcDir, 'OldGate.ts');
  fs.writeFileSync(gate, 'export function useGate() { return true; }\n');
  const planPath = writePlan(dir, { feature: 'checkout', units: [{ name: 'CpoAccess', layers: ['domain', 'hook'], from: gate }] });

  const { results } = await importPlan(dir, planPath);
  assert.equal(results.length, 1);
  assert.ok(results[0].timings);
  assert.ok(results[0].timings.scaffoldSeconds >= 0);
  assert.ok(results[0].timings.totalSeconds >= 0);
});

// ---- #275: a plan unit with a controller but no page ----------------------
//
// The LLM's analysis varies run to run and intermittently proposed
// ["hook","controller"] with no page, which used to blow up mid-build with
// "Construct generated code that fails its own architecture rules (template
// bug): IMPORT-001 ... '../pages/XPage' does not resolve" — after some files
// had already been written. A plan's layers are a proposal, not a typed
// instruction, so they are deterministically repaired before anything runs.

test('#275 validatePlanShape adds the missing page to a controller-only unit and reports it', () => {
  const plan = {
    feature: 'checkout',
    units: [
      { name: 'Products', layers: ['hook', 'controller'], from: 'old/Products.tsx' },
      { name: 'Cart', layers: ['domain'], from: 'old/Cart.ts' },
    ],
  };
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (m) => warnings.push(m);
  try {
    validatePlanShape(plan, 'test');
  } finally {
    console.warn = originalWarn;
  }
  // Repaired, and in canonical build order (page before controller).
  assert.deepEqual(plan.units[0].layers, ['hook', 'page', 'controller']);
  // Units that were already fine are untouched.
  assert.deepEqual(plan.units[1].layers, ['domain']);
  assert.deepEqual(plan.layerAdjustments, [{ unit: 'Products', added: ['page'] }]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /unit "Products" needed "page" added/);
});

test('#275 normalizePlanLayers is a no-op for a plan that is already buildable', () => {
  const plan = {
    feature: 'checkout',
    units: [{ name: 'Products', layers: ['page', 'controller'], from: 'old/Products.tsx' }],
  };
  assert.deepEqual(normalizePlanLayers(plan), []);
  assert.deepEqual(plan.units[0].layers, ['page', 'controller']);
  assert.equal('layerAdjustments' in plan, false);
});

test('#275 importPlan builds a controller-only unit cleanly instead of failing with a "template bug"', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const sourceFile = path.join(dir, 'Old.tsx');
  fs.writeFileSync(sourceFile, 'export function old() { return true; }\n');
  const planPath = path.join(dir, 'plan.json');
  fs.writeFileSync(
    planPath,
    JSON.stringify({ feature: 'checkout', units: [{ name: 'Products', layers: ['hook', 'controller'], from: sourceFile }] }),
  );

  const originalWarn = console.warn;
  console.warn = () => {};
  let out;
  try {
    out = await importPlan(dir, planPath);
  } finally {
    console.warn = originalWarn;
  }

  assert.deepEqual(out.results[0].files.map((f) => path.basename(f)), [
    'useProducts.tsx',
    'ProductsPage.tsx',
    'ProductsController.tsx',
  ]);
  // The whole point: the result validates clean, no IMPORT-001 left behind.
  assert.deepEqual(validateArchitecture(dir).violations.filter((v) => v.severity === 'error'), []);
});

test('#275 an LLM-proposed plan with a controller but no page is repaired before it is returned', async () => {
  const dir = tmpProject();
  const routeDir = path.join(dir, 'route');
  fs.mkdirSync(routeDir, { recursive: true });
  fs.writeFileSync(path.join(routeDir, 'Products.tsx'), 'export function Products() { return null; }\n');

  const originalClaude = PROVIDERS.claude;
  const originalWarn = console.warn;
  console.warn = () => {};
  PROVIDERS.claude = () =>
    JSON.stringify({ feature: 'checkout', units: [{ name: 'Products', layers: ['hook', 'controller'], from: 'Products.tsx' }] });
  let plan;
  try {
    plan = await analyzeRoute(routeDir, 'checkout');
  } finally {
    PROVIDERS.claude = originalClaude;
    console.warn = originalWarn;
  }
  assert.deepEqual(plan.units[0].layers, ['hook', 'page', 'controller']);
  assert.deepEqual(plan.layerAdjustments, [{ unit: 'Products', added: ['page'] }]);
});

test('#275 normalising a plan does not mask an unknown layer name in the same unit', async () => {
  const dir = tmpProject();
  const routeDir = path.join(dir, 'route');
  fs.mkdirSync(routeDir, { recursive: true });
  fs.writeFileSync(path.join(routeDir, 'Products.tsx'), 'export function Products() { return null; }\n');

  const originalClaude = PROVIDERS.claude;
  const originalWarn = console.warn;
  console.warn = () => {};
  PROVIDERS.claude = () =>
    JSON.stringify({ feature: 'checkout', units: [{ name: 'Products', layers: ['controller', 'widget'], from: 'Products.tsx' }] });
  try {
    await assert.rejects(() => analyzeRoute(routeDir, 'checkout'), /proposed unknown layer\(s\) \["widget"\]/);
  } finally {
    PROVIDERS.claude = originalClaude;
    console.warn = originalWarn;
  }
});

test('#275 importVertical with an explicit controller-without-page --layers list is still refused', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const sourceFile = path.join(dir, 'Old.tsx');
  fs.writeFileSync(sourceFile, 'export function old() { return true; }\n');
  await assert.rejects(
    () => importVertical(dir, 'Products', 'checkout', ['hook', 'controller'], sourceFile),
    /a "controller" needs a "page" layer/,
  );
});

test('importVertical with { llm: "ollama" } calls the ollama provider (mocked HTTP) and writes its response', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const sourceFile = path.join(dir, 'Old.tsx');
  fs.writeFileSync(sourceFile, 'export function old() { return true; }\n');

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    status: 200,
    text: async () => JSON.stringify({ response: 'export function Foo() { return 1; }' }),
  });
  try {
    const result = await importVertical(dir, 'Foo', 'checkout', ['domain'], sourceFile, { llm: 'ollama' });
    assert.equal(result.llmFilled, true);
    const content = fs.readFileSync(result.files[0], 'utf8');
    assert.equal(content.trim(), 'export function Foo() { return 1; }');
  } finally {
    global.fetch = originalFetch;
  }
});

// Real-project dogfood case (2026-09-24): a controller stub already composes its own Page
// component (`return <${n}Page />;`, controllerTemplates in generators.mjs), but the old
// (pre-Construct) source file rendered its UI directly -- the port prompt used to say only "port
// the old file's logic here," so the model faithfully copied the old file's JSX return statement
// into the controller too, orphaning the real Page file. This asserts the fix: the controller
// layer's prompt explicitly tells the model that composition is load-bearing.
test('#<import-composition-fix>: the controller-layer port prompt tells the model to preserve its existing Page composition, not inline UI over it', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const sourceFile = path.join(dir, 'OldPage.tsx');
  fs.writeFileSync(
    sourceFile,
    "import SetNewPassword from './SetNewPassword';\nexport function OldPage() {\n  return <SetNewPassword />;\n}\n",
  );

  let capturedPrompts = [];
  const originalClaude = PROVIDERS.claude;
  PROVIDERS.claude = (prompt) => {
    capturedPrompts.push(prompt);
    // A deliberately unfilled response is fine here -- this test only inspects what the model
    // was TOLD, not what it did with it.
    return '';
  };
  try {
    await importVertical(dir, 'ResetPassword', 'checkout', ['page', 'controller'], sourceFile, { llm: 'claude' });
  } finally {
    PROVIDERS.claude = originalClaude;
  }

  const controllerPrompt = capturedPrompts.find((p) => p.includes('layer: "controller"'));
  assert.ok(controllerPrompt, 'expected a prompt for the controller layer');
  assert.match(controllerPrompt, /composition is load-bearing, not/);
  assert.match(controllerPrompt, /keep it/);
  // The instruction is layer-scoped: a page-layer prompt should not claim to already compose
  // ANOTHER file the way a controller stub does, so it shouldn't repeat the controller-specific
  // wording verbatim -- both prompts share the general "split across several files" framing, but
  // only the composition-preservation sentence is controller-specific by construction (any layer
  // stub could in principle already import another generated file, so this just confirms the
  // shared instruction text is present for every layer, not that it's controller-exclusive).
  const pagePrompt = capturedPrompts.find((p) => p.includes('layer: "page"'));
  assert.ok(pagePrompt, 'expected a prompt for the page layer');
  assert.match(pagePrompt, /split across SEVERAL files by layer/);
});
