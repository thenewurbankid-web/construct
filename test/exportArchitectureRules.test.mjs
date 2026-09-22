// #513 (extends #437, part of #500's typed-contracts epic): packages/core/exportArchitectureRules.mjs
// exports Construct's own layer graph to a real eslint-plugin-boundaries config -- a CI-time/
// editor-time complement to `construct validate`, not a replacement for it.
//
// Two kinds of proof here, deliberately:
//  1. Pure unit tests of the generator's own output shape, against the real DEFAULT_LAYERS/
//     REACT_SPA_LAYERS graphs (packages/core/config.mjs) -- "the generator's output is correct",
//     not just "it runs".
//  2. A real end-to-end run: the generated config, real `eslint-plugin-boundaries`, real
//     `@typescript-eslint/parser`, against a temp copy of the checked-in
//     fixtures/architecture-valid-react-spa fixture -- a clean pass on the real fixture, and a
//     real catch on a deliberately bad cross-layer import added only to the temp copy (never
//     committed).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import boundaries from 'eslint-plugin-boundaries';
import tsParser from '@typescript-eslint/parser';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { CANONICAL_LAYERS } from '../packages/core/architecture-graph.mjs';
import { DEFAULT_LAYERS, REACT_SPA_LAYERS } from '../packages/core/config.mjs';
import {
  TYPES_ELEMENT_PATTERN,
  boundariesElements,
  boundariesDependencyPolicies,
  exportBoundariesConfigFromGraph,
  exportBoundariesConfig,
  generateEslintFlatConfigModule,
} from '../packages/core/exportArchitectureRules.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REACT_SPA_FIXTURE = path.join(ROOT, 'fixtures/architecture-valid-react-spa');

// ---------------------------------------------------------------------------
// 1. Unit tests: generator output shape
// ---------------------------------------------------------------------------

test('boundariesElements: one {type, pattern} entry per real layer, plus the types pseudo-layer, sorted by type', () => {
  const elements = boundariesElements(DEFAULT_LAYERS);
  const names = elements.map((e) => e.type);
  assert.deepEqual(names, [...names].sort(), 'sorted by type name');
  for (const [layer, def] of Object.entries(DEFAULT_LAYERS)) {
    const el = elements.find((e) => e.type === layer);
    assert.ok(el, `missing element for layer "${layer}"`);
    assert.equal(el.pattern, def.pattern);
  }
  const typesEl = elements.find((e) => e.type === 'types');
  assert.ok(typesEl, 'the "types" pseudo-layer must appear as a real element');
  assert.equal(typesEl.pattern, TYPES_ELEMENT_PATTERN);
});

test('boundariesElements: a file-shaped pattern (route\'s single entry file, types.ts) gets partialMatch: false; a folder pattern does not', () => {
  const elements = boundariesElements(DEFAULT_LAYERS);
  const route = elements.find((e) => e.type === 'route');
  const types = elements.find((e) => e.type === 'types');
  const component = elements.find((e) => e.type === 'component');
  assert.equal(route.partialMatch, false, 'app/**/page.tsx names a specific file per route folder');
  assert.equal(types.partialMatch, false);
  assert.equal(component.partialMatch, undefined, 'features/*/components/** is a real folder pattern');
});

test('boundariesElements: react-spa\'s route pattern (src/App.tsx) is exported the same way as nextjs\'s', () => {
  const elements = boundariesElements(REACT_SPA_LAYERS);
  const route = elements.find((e) => e.type === 'route');
  assert.equal(route.pattern, 'src/App.tsx');
  assert.equal(route.partialMatch, false);
});

test('boundariesDependencyPolicies: one policy per layer with a non-empty canImport, using object-based element selectors', () => {
  const policies = boundariesDependencyPolicies(CANONICAL_LAYERS);
  for (const [layer, def] of Object.entries(CANONICAL_LAYERS)) {
    if (!def.canImport || def.canImport.length === 0) continue;
    const policy = policies.find((p) => p.from.element.type === layer);
    assert.ok(policy, `missing policy for layer "${layer}"`);
    assert.deepEqual(policy.allow.to.element.types.anyOf, [...new Set(def.canImport)].sort());
  }
});

test('boundariesDependencyPolicies: a layer with no canImport (none in the default graph, but a project override could add one) produces no policy', () => {
  const graphWithDeadEnd = { ...CANONICAL_LAYERS, sink: { pattern: 'features/*/sink/**', canImport: [] } };
  const policies = boundariesDependencyPolicies(graphWithDeadEnd);
  assert.ok(!policies.some((p) => p.from.element.type === 'sink'));
});

test('exportBoundariesConfigFromGraph: the canImport graph round-trips exactly through settings + rules', () => {
  const { settings, rules } = exportBoundariesConfigFromGraph(DEFAULT_LAYERS);
  assert.deepEqual(Object.keys(settings), ['boundaries/elements', 'import/resolver']);
  assert.deepEqual(rules['boundaries/dependencies'][0], 'error');
  assert.equal(rules['boundaries/dependencies'][1].default, 'disallow');
  const pagePolicy = rules['boundaries/dependencies'][1].policies.find((p) => p.from.element.type === 'page');
  assert.deepEqual(pagePolicy.allow.to.element.types.anyOf, ['component', 'types']);
  const componentPolicy = rules['boundaries/dependencies'][1].policies.find((p) => p.from.element.type === 'component');
  assert.deepEqual(componentPolicy.allow.to.element.types.anyOf, ['component', 'types']);
  assert.ok(
    !componentPolicy.allow.to.element.types.anyOf.includes('service'),
    'component must not be allowed to import service, mirroring COMPONENT-003',
  );
});

test('exportBoundariesConfigFromGraph: sets import/resolver TS extensions -- load-bearing, not cosmetic', () => {
  // Without this, eslint-module-utils' default resolver only tries .js/.mjs/.json/.node, every
  // relative import into a Construct project's .ts/.tsx files fails to resolve, and
  // boundaries/dependencies silently reports zero violations no matter how layers are wired
  // (reproduced for real below in the end-to-end section, and while developing this generator).
  const { settings } = exportBoundariesConfigFromGraph(DEFAULT_LAYERS);
  assert.deepEqual(settings['import/resolver'], { node: { extensions: ['.js', '.jsx', '.ts', '.tsx'] } });
});

test('exportBoundariesConfig: loads a real project\'s architecture.yml (react-spa fixture) end to end', () => {
  const { settings, rules } = exportBoundariesConfig(REACT_SPA_FIXTURE);
  const route = settings['boundaries/elements'].find((e) => e.type === 'route');
  assert.equal(route.pattern, 'src/App.tsx');
  const routePolicy = rules['boundaries/dependencies'][1].policies.find((p) => p.from.element.type === 'route');
  assert.deepEqual(routePolicy.allow.to.element.types.anyOf, ['controller']);
});

test('generateEslintFlatConfigModule: renders a real, importable ESM flat-config module', async () => {
  // Written under the repo's own .construct-test-tmp/ (gitignored, already the sanctioned
  // location for test scratch files at the repo root) so Node's own ESM resolution walks up to
  // the real node_modules/eslint-plugin-boundaries -- a tempdir elsewhere has no node_modules of
  // its own to resolve a bare specifier against, which would test path resolution, not shape.
  const scratchDir = path.join(ROOT, '.construct-test-tmp');
  fs.mkdirSync(scratchDir, { recursive: true });
  const modulePath = path.join(scratchDir, `eslint-export-test-${process.pid}.mjs`);
  fs.writeFileSync(modulePath, generateEslintFlatConfigModule(REACT_SPA_FIXTURE));
  try {
    const mod = await import(`file://${modulePath}`);
    const config = mod.default;
    assert.ok(Array.isArray(config) && config.length === 1);
    assert.equal(config[0].plugins.boundaries, boundaries, 'imports the real eslint-plugin-boundaries default export');
    assert.deepEqual(config[0].settings, exportBoundariesConfig(REACT_SPA_FIXTURE).settings);
    assert.deepEqual(config[0].rules, exportBoundariesConfig(REACT_SPA_FIXTURE).rules);
  } finally {
    fs.rmSync(modulePath, { force: true });
  }
});

// ---------------------------------------------------------------------------
// 2. Real end-to-end: generated config + real eslint-plugin-boundaries + real ESLint, against a
//    temp copy of the checked-in react-spa fixture.
// ---------------------------------------------------------------------------

/** Build a real ESLint instance wired with the generated config for `projectRoot`, a TS parser
 * (the react-spa fixture is real TypeScript+JSX), and JSX enabled. */
function eslintFor(projectRoot) {
  const { settings, rules } = exportBoundariesConfig(projectRoot);
  const overrideConfig = [
    {
      files: ['**/*.ts', '**/*.tsx'],
      plugins: { boundaries },
      settings,
      rules,
      languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
    },
  ];
  return new ESLint({ cwd: projectRoot, overrideConfigFile: true, overrideConfig });
}

test('end-to-end: the generated config passes clean on the real, checked-in valid react-spa fixture', async () => {
  const eslint = eslintFor(REACT_SPA_FIXTURE);
  const results = await eslint.lintFiles(['features/**/*.{ts,tsx}', 'src/**/*.tsx']);
  const totalErrors = results.reduce((n, r) => n + r.errorCount, 0);
  const messages = results.flatMap((r) => r.messages.map((m) => `${path.relative(REACT_SPA_FIXTURE, r.filePath)}: ${m.ruleId} ${m.message}`));
  assert.equal(totalErrors, 0, `expected a clean pass, got:\n${messages.join('\n')}`);
  assert.ok(results.length >= 9, 'sanity: the fixture\'s real files were actually linted');
});

test('end-to-end: a deliberately bad cross-layer import (component -> service) is caught as a real boundaries/dependencies violation', async () => {
  const dir = makeTempDir('construct-eslint-export-e2e-');
  fs.cpSync(REACT_SPA_FIXTURE, dir, { recursive: true });
  // A component importing a service directly violates the same edge COMPONENT-003 polices
  // (component's canImport is ['component', 'types'] only) -- added ONLY to this temp copy,
  // never to the committed fixture.
  fs.writeFileSync(
    path.join(dir, 'features/widget/components/BadImport.tsx'),
    "import { WidgetService } from '../services/WidgetService';\n\n" +
      'export function BadImport() {\n  WidgetService();\n  return <div>bad</div>;\n}\n',
  );

  const eslint = eslintFor(dir);
  const results = await eslint.lintFiles(['features/**/*.{ts,tsx}', 'src/**/*.tsx']);
  const bad = results.find((r) => r.filePath.endsWith('BadImport.tsx'));
  assert.ok(bad, 'BadImport.tsx must have been linted');
  assert.equal(bad.errorCount, 1);
  assert.equal(bad.messages[0].ruleId, 'boundaries/dependencies');
  assert.match(bad.messages[0].message, /type "component".*type "service"/);

  // Every other file in the temp copy is still clean -- the violation is scoped to the one bad
  // file, not a false positive spread across the whole fixture.
  const otherErrors = results.filter((r) => !r.filePath.endsWith('BadImport.tsx')).reduce((n, r) => n + r.errorCount, 0);
  assert.equal(otherErrors, 0);
});

test('end-to-end: without the TS resolver extension setting, the same violation is silently missed (regression guard for the load-bearing setting above)', async () => {
  const dir = makeTempDir('construct-eslint-export-noresolver-');
  fs.cpSync(REACT_SPA_FIXTURE, dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'features/widget/components/BadImport.tsx'),
    "import { WidgetService } from '../services/WidgetService';\n\n" +
      'export function BadImport() {\n  WidgetService();\n  return <div>bad</div>;\n}\n',
  );

  const { settings, rules } = exportBoundariesConfig(dir);
  const settingsWithoutResolver = { ...settings };
  delete settingsWithoutResolver['import/resolver'];
  const overrideConfig = [
    {
      files: ['**/*.ts', '**/*.tsx'],
      plugins: { boundaries },
      settings: settingsWithoutResolver,
      rules,
      languageOptions: { parser: tsParser, parserOptions: { ecmaFeatures: { jsx: true } } },
    },
  ];
  const eslint = new ESLint({ cwd: dir, overrideConfigFile: true, overrideConfig });
  const results = await eslint.lintFiles(['features/widget/components/BadImport.tsx']);
  const totalErrors = results.reduce((n, r) => n + r.errorCount, 0);
  assert.equal(totalErrors, 0, 'demonstrates the silent-pass failure mode the resolver setting fixes');
});
