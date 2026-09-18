import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { importRouteWizard } from '../src/cli.mjs';
import { createFeature } from '../src/generators.mjs';
import { PROVIDERS } from '../src/llm.mjs';

function tmpProject() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'construct-wizard-'));
}

function scriptedAsk(answers) {
  const queue = [...answers];
  return async () => queue.shift() ?? '';
}

/** `importRouteWizard` resolves its build root via `process.cwd()` (same as
 * every other command), so these tests chdir into a scratch project —
 * always restored afterward, even on failure, so no other test in this
 * process ever sees a changed cwd. */
async function inProject(dir, fn) {
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    await fn();
  } finally {
    process.chdir(originalCwd);
  }
}

/** A minimal Next.js route folder — a page.tsx entry file plus whatever
 * files it imports — so route-resolver.mjs's findRouteEntryFile/
 * traceRouteFiles has something real to resolve. `imports` is a list of
 * relative specifiers (e.g. './Old') the page.tsx re-exports/imports;
 * `extraFiles` is { filename: content } for those imported files. */
function buildRouteFixture(imports, extraFiles) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-wizard-route-'));
  const importLines = imports.map((spec, i) => `import x${i} from "${spec}";`).join('\n');
  fs.writeFileSync(path.join(dir, 'page.tsx'), `${importLines}\nexport default function Page() { return null; }\n`);
  for (const [name, content] of Object.entries(extraFiles)) {
    fs.writeFileSync(path.join(dir, name), content);
  }
  return dir;
}

function withFakeAnalysis(planJson, fn) {
  const original = PROVIDERS.claude;
  const calls = [];
  PROVIDERS.claude = (prompt) => {
    calls.push(prompt);
    return typeof planJson === 'function' ? planJson(calls.length) : JSON.stringify(planJson);
  };
  return (async () => {
    try {
      return await fn(calls);
    } finally {
      PROVIDERS.claude = original;
    }
  })();
}

test('importRouteWizard cancels cleanly when no feature name is given', async () => {
  const dir = tmpProject();
  const routeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-wizard-route-'));
  fs.writeFileSync(path.join(routeDir, 'Old.ts'), 'export function old() { return true; }\n');

  await inProject(dir, () =>
    withFakeAnalysis({}, async (calls) => {
      await importRouteWizard(scriptedAsk(['']), routeDir);
      assert.equal(calls.length, 0, 'must not analyze anything before a feature name is given');
    }),
  );
});

test('importRouteWizard builds nothing when the plan is not approved', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const routeDir = buildRouteFixture(['./Old'], { 'Old.ts': 'export function old() { return true; }\n' });

  await inProject(dir, () =>
    withFakeAnalysis({ feature: 'checkout', units: [{ name: 'Foo', layers: ['domain'], from: 'Old.ts' }] }, async () => {
      await importRouteWizard(scriptedAsk(['checkout', '', 'n', 'n']), routeDir);
    }),
  );

  assert.equal(fs.existsSync(path.join(dir, 'features', 'checkout', 'domain', 'Foo.tsx')), false);
});

test('importRouteWizard builds the approved plan with breadcrumbs (no llm fill requested)', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const routeDir = buildRouteFixture(['./Old'], { 'Old.ts': 'export function old() { return true; }\n' });

  await inProject(dir, () =>
    withFakeAnalysis(
      { feature: 'checkout', units: [{ name: 'Foo', layers: ['domain', 'hook'], from: 'Old.ts' }] },
      async (calls) => {
        await importRouteWizard(scriptedAsk(['checkout', '', 'n', 'y']), routeDir);
        assert.equal(calls.length, 1, 'exactly one analysis call, no fill calls');
      },
    ),
  );

  const domainFile = path.join(dir, 'features', 'checkout', 'domain', 'Foo.tsx');
  assert.equal(fs.existsSync(domainFile), true);
  assert.match(fs.readFileSync(domainFile, 'utf8'), /TODO\(import\)/);
  assert.equal(fs.existsSync(path.join(dir, 'features', 'checkout', 'hooks', 'useFoo.tsx')), true);
});

test('importRouteWizard with llm-fill approved calls the provider once for analysis and once per file', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const routeDir = buildRouteFixture(['./Old'], { 'Old.ts': 'export function old() { return true; }\n' });

  const planJson = JSON.stringify({ feature: 'checkout', units: [{ name: 'Foo', layers: ['domain'], from: 'Old.ts' }] });
  await inProject(dir, () =>
    withFakeAnalysis(
      (callNumber) => (callNumber === 1 ? planJson : '```ts\nexport function Foo() { return true; }\n```'),
      async (calls) => {
        await importRouteWizard(scriptedAsk(['checkout', '', 'y', 'y']), routeDir);
        assert.equal(calls.length, 2, '1 analysis call + 1 fill call for the single generated file');
      },
    ),
  );

  const domainFile = path.join(dir, 'features', 'checkout', 'domain', 'Foo.tsx');
  assert.doesNotMatch(fs.readFileSync(domainFile, 'utf8'), /TODO\(import\)/);
});

test('importRouteWizard auto-creates the feature when it does not exist yet, without touching it if it does', async () => {
  const dir = tmpProject();
  const routeDir = buildRouteFixture(['./Old'], { 'Old.ts': 'export function old() { return true; }\n' });

  await inProject(dir, () =>
    withFakeAnalysis({ feature: 'checkout', units: [{ name: 'Foo', layers: ['domain'], from: 'Old.ts' }] }, () =>
      importRouteWizard(scriptedAsk(['checkout', '', 'n', 'n']), routeDir),
    ),
  );

  // Cancelled before building, but the feature itself should already have
  // been auto-created (folders + types.ts/index.ts) since it didn't exist.
  assert.equal(fs.existsSync(path.join(dir, 'features', 'checkout', 'types.ts')), true);
  const typesContent = fs.readFileSync(path.join(dir, 'features', 'checkout', 'types.ts'), 'utf8');

  // Re-running against the SAME feature must not clobber it — simulate
  // real accumulated content by hand-editing types.ts, then run the wizard
  // again and confirm that edit survived.
  fs.writeFileSync(path.join(dir, 'features', 'checkout', 'types.ts'), `${typesContent}\nexport type Extra = string;\n`);

  await inProject(dir, () =>
    withFakeAnalysis({ feature: 'checkout', units: [{ name: 'Bar', layers: ['domain'], from: 'Old.ts' }] }, () =>
      importRouteWizard(scriptedAsk(['checkout', '', 'n', 'n']), routeDir),
    ),
  );

  assert.match(fs.readFileSync(path.join(dir, 'features', 'checkout', 'types.ts'), 'utf8'), /Extra/);
});

test('importRouteWizard loops to accept multiple routes into one combined plan', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const hooksDir = buildRouteFixture(['./useFoo'], { 'useFoo.ts': 'export function useFoo() { return true; }\n' });
  const pagesDir = buildRouteFixture(['./Foo'], { 'Foo.tsx': 'export function Foo() { return null; }\n' });

  await inProject(dir, () =>
    withFakeAnalysis(
      {
        feature: 'checkout',
        units: [
          { name: 'Foo', layers: ['hook'], from: 'useFoo.ts' },
          { name: 'Foo', layers: ['page'], from: 'Foo.tsx' },
        ],
      },
      async (calls) => {
        // seedRoute = hooksDir; then one more route (pagesDir); then blank
        // to finish the loop; then fillWithLlm=n; then approve=y.
        await importRouteWizard(scriptedAsk(['checkout', pagesDir, '', 'n', 'y']), hooksDir);
        assert.equal(calls.length, 1, 'one combined analysis call covering both routes');
        assert.match(calls[0], /useFoo\.ts/);
        assert.match(calls[0], /Foo\.tsx/);
      },
    ),
  );

  assert.equal(fs.existsSync(path.join(dir, 'features', 'checkout', 'hooks', 'useFoo.tsx')), true);
  assert.equal(fs.existsSync(path.join(dir, 'features', 'checkout', 'pages', 'FooPage.tsx')), true);
});

// #78 — for a react-spa project (config.project.framework: react-spa), the
// wizard must branch its prompts: no "Next.js app/ directory" question at
// all (resolveRoute auto-locates the routes table by convention — #66), and
// the "Route to import" prompt worded for a controller file, not a folder.
test('importRouteWizard branches to react-spa wording and resolves via the routes table, never asking for an app/ directory', async () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'project:\n  framework: react-spa\n');
  createFeature(dir, 'checkout');

  // A minimal react-spa routing setup living in the project itself (mirrors
  // ui/client's real shape): src/App.tsx's routes table, plus the
  // controller file /dashboard resolves to.
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src/App.tsx'),
    [
      "import { Routes, Route } from 'react-router-dom';",
      "import { DashboardController } from '../features/dashboard/controllers/DashboardController';",
      'export function App() {',
      '  return (<Routes><Route path="/dashboard" element={<DashboardController />} /></Routes>);',
      '}',
      '',
    ].join('\n'),
  );
  fs.mkdirSync(path.join(dir, 'features/dashboard/controllers'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'features/dashboard/controllers/DashboardController.tsx'), 'export function DashboardController() { return null; }\n');

  const prompts = [];
  const answers = ['checkout', '/dashboard', '', 'n', 'y'];
  const ask = async (p) => {
    prompts.push(p);
    return answers.shift() ?? '';
  };

  await inProject(dir, () =>
    withFakeAnalysis({ feature: 'checkout', units: [{ name: 'Foo', layers: ['domain'], from: 'DashboardController.tsx' }] }, async (calls) => {
      await importRouteWizard(ask);
      assert.equal(calls.length, 1, 'one combined analysis call');
      assert.match(calls[0], /DashboardController\.tsx/);
    }),
  );

  assert.ok(
    prompts.some((p) => p.includes('controller file path')),
    `expected a react-spa-worded "Route to import" prompt, got: ${JSON.stringify(prompts)}`,
  );
  assert.ok(
    !prompts.some((p) => p.includes('app/ directory')),
    `must never ask the nextjs "app/ directory" question for a react-spa project, got: ${JSON.stringify(prompts)}`,
  );
  assert.equal(fs.existsSync(path.join(dir, 'features', 'checkout', 'domain', 'Foo.tsx')), true);
});

test('importRouteWizard resolves a react-spa route directly from an existing controller file path, still no app/ directory question', async () => {
  const dir = tmpProject();
  fs.writeFileSync(path.join(dir, 'architecture.yml'), 'project:\n  framework: react-spa\n');
  createFeature(dir, 'checkout');
  fs.mkdirSync(path.join(dir, 'features/dashboard/controllers'), { recursive: true });
  const controllerFile = path.join(dir, 'features/dashboard/controllers/DashboardController.tsx');
  fs.writeFileSync(controllerFile, 'export function DashboardController() { return null; }\n');

  const prompts = [];
  const answers = ['checkout', '', 'n', 'n'];
  const ask = async (p) => {
    prompts.push(p);
    return answers.shift() ?? '';
  };

  await inProject(dir, () =>
    withFakeAnalysis({}, async (calls) => {
      // Seeded directly with the controller file path — an already-resolved
      // source, same as a nextjs route folder path today.
      await importRouteWizard(ask, controllerFile);
      assert.equal(calls.length, 1);
    }),
  );

  assert.ok(!prompts.some((p) => p.includes('app/ directory')));
});

test('importRouteWizard reports an analysis failure without throwing', async () => {
  const dir = tmpProject();
  createFeature(dir, 'checkout');
  const missingRoute = path.join(os.tmpdir(), 'construct-wizard-route-does-not-exist');

  await inProject(dir, () =>
    withFakeAnalysis({}, async (calls) => {
      await importRouteWizard(scriptedAsk(['checkout', '', 'n']), missingRoute);
      assert.equal(calls.length, 0);
    }),
  );
});
