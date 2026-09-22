import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  resolveUrlToFolder,
  findRouteEntryFile,
  readPathAliases,
  resolveImportSpecifier,
  traceRouteFiles,
  resolveRoute,
  DEFAULT_TRACE_EXCLUDES,
  findReactSpaRoutesFile,
  parseReactSpaRoutes,
  findControllerFile,
} from '../packages/core/route-resolver.mjs';
import { ConstructError } from '../packages/core/diagnostics.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

function tmpProject() {
  return makeTempDir('construct-route-');
}

function write(root, relPath, content) {
  const abs = path.join(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

/** Mimics max-ai-ui's actual shape closely enough to exercise every rule:
 * a dynamic [locale] segment, a route-group wrapper, a real route
 * (/v2/home), a sibling unrelated route, page.tsx -> Client.tsx -> a hook
 * (@/-aliased) + a page component (@/-aliased) -> a further @/-aliased
 * component, plus an excluded (ui-v2) and an external (bare package, node
 * built-in-style) import that must not be followed. */
function buildFixtureProject() {
  const root = tmpProject();
  write(root, 'tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } } }));
  write(
    root,
    'src/app/[locale]/v2/(with-topbar)/home/page.tsx',
    `import HomeClient from "./HomeClient";\nexport default function Page() { return <HomeClient />; }\n`,
  );
  write(
    root,
    'src/app/[locale]/v2/(with-topbar)/home/HomeClient.tsx',
    [
      'import { useCpoHomeData } from "@/hooks/v2/cpo/useCpoHomeData";',
      'import CpoHome from "@/subframe-pages-v2/Cpo/CpoHome";',
      'import { Badge } from "@/ui-v2/components/Badge";',
      'import { useRouter } from "next/navigation";',
      'export default function HomeClient() { return null; }',
      '',
    ].join('\n'),
  );
  write(root, 'src/hooks/v2/cpo/useCpoHomeData.ts', 'export function useCpoHomeData() { return {}; }\n');
  write(
    root,
    'src/subframe-pages-v2/Cpo/CpoHome.tsx',
    'import { ExposureCard } from "./ExposureCard";\nexport default function CpoHome() { return null; }\n',
  );
  write(root, 'src/subframe-pages-v2/Cpo/ExposureCard.tsx', 'export function ExposureCard() { return null; }\n');
  write(root, 'src/ui-v2/components/Badge.tsx', 'export function Badge() { return null; }\n');
  // an unrelated sibling route that must never show up in /v2/home's trace
  write(root, 'src/app/[locale]/v2/(with-topbar)/portfolio-pulse/page.tsx', 'export default function Page() { return null; }\n');
  return root;
}

test('resolveUrlToFolder finds the route folder through a dynamic segment and a route group', () => {
  const root = buildFixtureProject();
  const folder = resolveUrlToFolder(path.join(root, 'src/app'), '/v2/home');
  assert.equal(folder, path.join(root, 'src/app/[locale]/v2/(with-topbar)/home'));
});

test('resolveUrlToFolder throws clearly when nothing matches', () => {
  const root = buildFixtureProject();
  assert.throws(() => resolveUrlToFolder(path.join(root, 'src/app'), '/v2/does-not-exist'), ConstructError);
});

test('findRouteEntryFile finds page.tsx', () => {
  const root = buildFixtureProject();
  const folder = path.join(root, 'src/app/[locale]/v2/(with-topbar)/home');
  assert.equal(findRouteEntryFile(folder), path.join(folder, 'page.tsx'));
});

test('findRouteEntryFile throws clearly when there is no page file', () => {
  const root = tmpProject();
  fs.mkdirSync(path.join(root, 'empty'));
  assert.throws(() => findRouteEntryFile(path.join(root, 'empty')), ConstructError);
});

test('readPathAliases reads the "@/*" -> "./src/*" mapping from tsconfig.json', () => {
  const root = buildFixtureProject();
  const { aliases } = readPathAliases(path.join(root, 'src/app/[locale]/v2/(with-topbar)/home'));
  assert.equal(aliases.length, 1);
  assert.equal(aliases[0].prefix, '@/');
  assert.equal(aliases[0].target, path.join(root, 'src'));
});

test('readPathAliases returns no aliases when no tsconfig/jsconfig exists', () => {
  const root = tmpProject();
  const nested = path.join(root, 'a', 'b', 'c');
  fs.mkdirSync(nested, { recursive: true });
  const { aliases } = readPathAliases(nested);
  assert.deepEqual(aliases, []);
});

test('resolveImportSpecifier resolves a relative import', () => {
  const root = buildFixtureProject();
  const from = path.join(root, 'src/subframe-pages-v2/Cpo/CpoHome.tsx');
  const resolved = resolveImportSpecifier(from, './ExposureCard', []);
  assert.equal(resolved, path.join(root, 'src/subframe-pages-v2/Cpo/ExposureCard.tsx'));
});

test('resolveImportSpecifier resolves an "@/" aliased import', () => {
  const root = buildFixtureProject();
  const from = path.join(root, 'src/app/[locale]/v2/(with-topbar)/home/HomeClient.tsx');
  const { aliases } = readPathAliases(path.dirname(from));
  const resolved = resolveImportSpecifier(from, '@/hooks/v2/cpo/useCpoHomeData', aliases);
  assert.equal(resolved, path.join(root, 'src/hooks/v2/cpo/useCpoHomeData.ts'));
});

test('resolveImportSpecifier returns null for a bare package import', () => {
  const root = buildFixtureProject();
  const from = path.join(root, 'src/app/[locale]/v2/(with-topbar)/home/HomeClient.tsx');
  assert.equal(resolveImportSpecifier(from, 'next/navigation', []), null);
});

test('traceRouteFiles follows the full graph and stops at excluded/external boundaries', () => {
  const root = buildFixtureProject();
  const entry = path.join(root, 'src/app/[locale]/v2/(with-topbar)/home/page.tsx');
  const { aliases } = readPathAliases(path.dirname(entry));
  const files = traceRouteFiles(entry, { aliases });

  const rel = (f) => path.relative(root, f).split(path.sep).join('/');
  const relFiles = files.map(rel).sort();

  assert.deepEqual(relFiles, [
    'src/app/[locale]/v2/(with-topbar)/home/HomeClient.tsx',
    'src/app/[locale]/v2/(with-topbar)/home/page.tsx',
    'src/hooks/v2/cpo/useCpoHomeData.ts',
    'src/subframe-pages-v2/Cpo/CpoHome.tsx',
    'src/subframe-pages-v2/Cpo/ExposureCard.tsx',
  ]);
  // The Subframe primitive must not appear — excluded by default, never followed.
  assert.ok(!relFiles.some((f) => f.includes('ui-v2')));
});

test('traceRouteFiles respects a custom excludes list', () => {
  const root = buildFixtureProject();
  const entry = path.join(root, 'src/app/[locale]/v2/(with-topbar)/home/page.tsx');
  const { aliases } = readPathAliases(path.dirname(entry));
  const files = traceRouteFiles(entry, { aliases, excludes: [...DEFAULT_TRACE_EXCLUDES, '/subframe-pages-v2/'] });
  const rel = (f) => path.relative(root, f).split(path.sep).join('/');
  assert.ok(!files.map(rel).some((f) => f.includes('subframe-pages-v2')));
});

test('resolveRoute with a folder path traces the whole graph in one call', () => {
  const root = buildFixtureProject();
  const { folder, entryFile, files } = resolveRoute(path.join(root, 'src/app/[locale]/v2/(with-topbar)/home'));
  assert.equal(folder, path.join(root, 'src/app/[locale]/v2/(with-topbar)/home'));
  assert.equal(entryFile, path.join(folder, 'page.tsx'));
  assert.equal(files.length, 5);
});

test('resolveRoute with a URL route resolves through appDir', () => {
  const root = buildFixtureProject();
  const { folder, files } = resolveRoute('/v2/home', { appDir: path.join(root, 'src/app') });
  assert.equal(folder, path.join(root, 'src/app/[locale]/v2/(with-topbar)/home'));
  assert.equal(files.length, 5);
});

test('resolveRoute with a URL route but no appDir throws a clear error', () => {
  assert.throws(() => resolveRoute('/v2/home', {}), ConstructError);
});

// --- react-spa: same combining tool, a genuinely different (not stubbed)
// convention — a centralized src/App.tsx routes table (mirroring ui/client/
// src/App.jsx's real shape) instead of one page.tsx per route folder. -----

/** Mirrors ui/client/src/App.jsx's actual shape closely enough to exercise
 * every rule: a centralized src/App.tsx with a react-router <Routes> table,
 * a real controller (features/dashboard/controllers/DashboardController.tsx)
 * that pulls in a page + a hook (@/-aliased) + a component, an excluded
 * (ui-v2) import, and a sibling unrelated route that must never show up. */
function buildReactSpaFixtureProject() {
  const root = tmpProject();
  write(root, 'tsconfig.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] } } }));
  write(
    root,
    'src/App.tsx',
    [
      "import { Routes, Route } from 'react-router-dom';",
      "import { DashboardController } from '../features/dashboard/controllers/DashboardController';",
      "import { SettingsController } from '../features/settings/controllers/SettingsController';",
      'export function App() {',
      '  return (',
      '    <Routes>',
      '      <Route path="/dashboard" element={<DashboardController />} />',
      '      <Route path="/settings" element={<SettingsController />} />',
      '    </Routes>',
      '  );',
      '}',
      '',
    ].join('\n'),
  );
  write(
    root,
    'features/dashboard/controllers/DashboardController.tsx',
    [
      "import { DashboardPage } from '../pages/DashboardPage';",
      "import { useDashboardData } from '@/hooks/useDashboardData';",
      "import { Badge } from '@/ui-v2/components/Badge';",
      'export function DashboardController() { return null; }',
      '',
    ].join('\n'),
  );
  write(root, 'features/dashboard/pages/DashboardPage.tsx', "import { Widget } from '../components/Widget';\nexport function DashboardPage() { return null; }\n");
  write(root, 'features/dashboard/components/Widget.tsx', 'export function Widget() { return null; }\n');
  write(root, 'src/hooks/useDashboardData.ts', 'export function useDashboardData() { return {}; }\n');
  write(root, 'src/ui-v2/components/Badge.tsx', 'export function Badge() { return null; }\n');
  // an unrelated sibling route that must never show up in /dashboard's trace
  write(root, 'features/settings/controllers/SettingsController.tsx', 'export function SettingsController() { return null; }\n');
  return root;
}

test('findReactSpaRoutesFile finds src/App.tsx', () => {
  const root = buildReactSpaFixtureProject();
  assert.equal(findReactSpaRoutesFile(root), path.join(root, 'src/App.tsx'));
});

test('findReactSpaRoutesFile throws clearly when no routes file exists', () => {
  const root = tmpProject();
  assert.throws(() => findReactSpaRoutesFile(root), ConstructError);
});

test('parseReactSpaRoutes extracts the path -> controller table in document order', () => {
  const root = buildReactSpaFixtureProject();
  const routes = parseReactSpaRoutes(fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8'));
  assert.deepEqual(routes, [
    { path: '/dashboard', component: 'DashboardController' },
    { path: '/settings', component: 'SettingsController' },
  ]);
});

// Epic #76 / #91: parseReactSpaRoutes moved from a regex over each <Route> tag's raw
// text to real JSX/AST parsing. Prove it handles things the old per-attribute regex
// approach was fragile against: a comment mentioning a fake route, attribute order
// (element before path), and a JSX attribute value containing a brace-like string that
// would confuse a naive regex scan for the closing `}` of `element={...}`.
test('parseReactSpaRoutes (#91): handles element-before-path attribute order, a decoy comment, and a brace-like string prop without misparsing', () => {
  const source = [
    "import { Routes, Route } from 'react-router-dom';",
    "// <Route path=\"/fake\" element={<FakeController />} /> — not real JSX, just a comment",
    'export function App() {',
    '  return (',
    '    <Routes>',
    '      <Route element={<DashboardController label="{not a brace}" />} path="/dashboard" />',
    '    </Routes>',
    '  );',
    '}',
    '',
  ].join('\n');
  assert.deepEqual(parseReactSpaRoutes(source), [{ path: '/dashboard', component: 'DashboardController' }]);
});

test('findControllerFile locates the one matching controller under features/*/controllers/', () => {
  const root = buildReactSpaFixtureProject();
  const found = findControllerFile(root, 'DashboardController');
  assert.equal(found, path.join(root, 'features/dashboard/controllers/DashboardController.tsx'));
});

test('findControllerFile throws clearly when no controller matches', () => {
  const root = buildReactSpaFixtureProject();
  assert.throws(() => findControllerFile(root, 'GhostController'), ConstructError);
});

test('resolveRoute with framework: react-spa and a URL resolves through the routes table to the controller and traces its graph', () => {
  const root = buildReactSpaFixtureProject();
  const { folder, entryFile, files, component } = resolveRoute('/dashboard', { framework: 'react-spa', root });
  assert.equal(component, 'DashboardController');
  assert.equal(entryFile, path.join(root, 'features/dashboard/controllers/DashboardController.tsx'));
  assert.equal(folder, path.dirname(entryFile));

  const rel = (f) => path.relative(root, f).split(path.sep).join('/');
  const relFiles = files.map(rel).sort();
  assert.deepEqual(relFiles, [
    'features/dashboard/components/Widget.tsx',
    'features/dashboard/controllers/DashboardController.tsx',
    'features/dashboard/pages/DashboardPage.tsx',
    'src/hooks/useDashboardData.ts',
  ]);
  // Excluded by default (ui-v2), and the unrelated /settings route must never appear.
  assert.ok(!relFiles.some((f) => f.includes('ui-v2') || f.includes('Settings')));
});

test('resolveRoute with framework: react-spa and a controller file path resolves directly, no routes file needed', () => {
  const root = buildReactSpaFixtureProject();
  const controllerFile = path.join(root, 'features/dashboard/controllers/DashboardController.tsx');
  const { entryFile, component } = resolveRoute(controllerFile, { framework: 'react-spa' });
  assert.equal(entryFile, controllerFile);
  assert.equal(component, undefined); // only known when resolved via the routes table
});

test('resolveRoute with framework: react-spa and a URL route but no root throws a clear error', () => {
  assert.throws(() => resolveRoute('/dashboard', { framework: 'react-spa' }), ConstructError);
});

test('resolveRoute with framework: react-spa throws a clear error for a URL with no matching <Route>', () => {
  const root = buildReactSpaFixtureProject();
  assert.throws(() => resolveRoute('/does-not-exist', { framework: 'react-spa', root }), ConstructError);
});

// #68: the same combining tool against the real, checked-in
// fixtures/architecture-valid-react-spa project (not a synthetic in-memory
// fixture) -- proof this resolves a route end to end in a project that also
// passes `construct validate`, not just in isolation.
test('resolveRoute with framework: react-spa resolves /dashboard against fixtures/architecture-valid-react-spa', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const root = path.join(repoRoot, 'fixtures', 'architecture-valid-react-spa');
  const { folder, entryFile, files, component } = resolveRoute('/dashboard', { framework: 'react-spa', root });
  assert.equal(component, 'WidgetController');
  assert.equal(entryFile, path.join(root, 'features/widget/controllers/WidgetController.tsx'));
  assert.equal(folder, path.dirname(entryFile));
  const rel = (f) => path.relative(root, f).split(path.sep).join('/');
  assert.deepEqual(files.map(rel).sort(), [
    'features/widget/components/WidgetComponent.tsx',
    'features/widget/controllers/WidgetController.tsx',
    'features/widget/pages/WidgetPage.tsx',
  ]);
});

// #82 — a second, multi-route real fixture (fixtures/architecture-valid-
// react-spa-multi-route): the single-route fixture above already exercised
// every code path in isolation, but never proved resolveRoute actually
// picks the *right* entry out of more than one <Route>, nor that it can
// resolve a react-router dynamic-segment-styled path (":id"). This fixture
// has 3 routes across 3 features (dashboard, settings, user).
test('resolveRoute with framework: react-spa picks the right route out of several against fixtures/architecture-valid-react-spa-multi-route', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const root = path.join(repoRoot, 'fixtures', 'architecture-valid-react-spa-multi-route');
  const rel = (f) => path.relative(root, f).split(path.sep).join('/');

  const dashboard = resolveRoute('/dashboard', { framework: 'react-spa', root });
  assert.equal(dashboard.component, 'DashboardController');
  assert.equal(dashboard.entryFile, path.join(root, 'features/dashboard/controllers/DashboardController.tsx'));
  assert.deepEqual(dashboard.files.map(rel).sort(), [
    'features/dashboard/components/DashboardComponent.tsx',
    'features/dashboard/controllers/DashboardController.tsx',
    'features/dashboard/pages/DashboardPage.tsx',
  ]);

  const settings = resolveRoute('/settings', { framework: 'react-spa', root });
  assert.equal(settings.component, 'SettingsController');
  assert.equal(settings.entryFile, path.join(root, 'features/settings/controllers/SettingsController.tsx'));
  assert.deepEqual(settings.files.map(rel).sort(), [
    'features/settings/components/SettingsComponent.tsx',
    'features/settings/controllers/SettingsController.tsx',
    'features/settings/pages/SettingsPage.tsx',
  ]);

  // Neither trace leaks the other route's (or the third route's) files.
  assert.ok(!dashboard.files.some((f) => rel(f).includes('settings') || rel(f).includes('/user/')));
  assert.ok(!settings.files.some((f) => rel(f).includes('dashboard') || rel(f).includes('/user/')));
});

test('resolveRoute with framework: react-spa resolves a react-router dynamic-segment-styled route ("/users/:id") against fixtures/architecture-valid-react-spa-multi-route', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const root = path.join(repoRoot, 'fixtures', 'architecture-valid-react-spa-multi-route');
  // route-resolver.mjs's react-spa URL matching is exact-string against the
  // routes table (no live param substitution), so the dynamic route is
  // resolved by its literal declared path, not a concrete URL like
  // "/users/42" -- see parseReactSpaRoutes/resolveReactSpaRoute.
  const { component, entryFile, files } = resolveRoute('/users/:id', { framework: 'react-spa', root });
  assert.equal(component, 'UserController');
  assert.equal(entryFile, path.join(root, 'features/user/controllers/UserController.tsx'));
  const rel = (f) => path.relative(root, f).split(path.sep).join('/');
  assert.deepEqual(files.map(rel).sort(), [
    'features/user/components/UserComponent.tsx',
    'features/user/controllers/UserController.tsx',
    'features/user/pages/UserPage.tsx',
  ]);
});

test('resolveRoute with framework: react-spa and a direct controller file path resolves fixtures/architecture-valid-react-spa-multi-route without the routes table', () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const root = path.join(repoRoot, 'fixtures', 'architecture-valid-react-spa-multi-route');
  const controllerFile = path.join(root, 'features/settings/controllers/SettingsController.tsx');
  const { entryFile, component } = resolveRoute(controllerFile, { framework: 'react-spa' });
  assert.equal(entryFile, controllerFile);
  assert.equal(component, undefined);
});
