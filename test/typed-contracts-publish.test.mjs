// #591 -- @line/construct-core's published package (`packages/core/package.json`) neither
// exported nor shipped `packages/core/typed-contracts/`, so `defineDomain`/`definePage`/etc. could
// only be imported by relative path from inside this repo; a real installed project importing
// `@line/construct-core/typed-contracts` (docs/staleness-by-layer.md, the README's Typed contracts
// section, `construct create`'s generated units) could never resolve it.
//
// Fix shipped (approach 1 of #591's two options): the `.ts` sources ship as-is (no compile step --
// there is no existing tsc-emit build anywhere in this repo; the root `build` script is
// `tsc --noEmit`, a type-check only), with a `types`/`default` export condition pointing at
// `typed-contracts/index.ts`. This fits the actual consumers: `construct init` only scaffolds
// Vite (react-spa) and Next.js projects (packages/core/scaffold.mjs), both already TS-aware
// (moduleResolution: "bundler", a `typescript` devDependency) -- see test/initScaffold.test.mjs's
// SHELL fixture for the scaffolded tsconfig shape this test's fixtures mirror.
//
// Three layers, each proving something the others can't:
//   1. `npm pack --dry-run --json` -- the exact file list npm would publish really does contain
//      the typed-contracts sources (not just "the files array looks right").
//   2. Node's own resolution algorithm, run from a fixture `node_modules/@line/construct-core`
//      built ONLY from that packed file list (so a file missing from `files` fails resolution
//      here exactly as it would for a real `npm install`) -- proves `exports` and `files` agree.
//   3. The real `tsc` binary, `moduleResolution: "bundler"` (the exact setting `construct init`
//      scaffolds), compiling a fixture unit that imports `@line/construct-core/typed-contracts` by
//      package specifier, not relative path -- proves a TS-aware downstream toolchain (Next.js,
//      Vite) can actually consume what got published, same bar as test/typed-contracts-tsc.test.mjs
//      already holds the in-repo examples to.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CORE_DIR = path.join(REPO_ROOT, 'packages', 'core');
const TSC = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsc');

const EXPECTED_TYPED_CONTRACTS_FILES = [
  'typed-contracts/brand.ts',
  'typed-contracts/factories.ts',
  'typed-contracts/feature.ts',
  'typed-contracts/index.ts',
  'typed-contracts/jsx-global.d.ts',
  'typed-contracts/propRef.ts',
  'typed-contracts/provider.ts',
  'typed-contracts/schema.ts',
  'typed-contracts/template.ts',
  'typed-contracts/trackedState.ts',
  'typed-contracts/units.ts',
];

/** Real `npm pack --dry-run --json` against packages/core -- no tarball written, no install. */
function packDryRun() {
  const res = spawnSync('npm', ['pack', '--dry-run', '--json'], { cwd: CORE_DIR, encoding: 'utf8' });
  assert.equal(res.status, 0, `npm pack --dry-run failed:\n${res.stderr}`);
  const [{ files }] = JSON.parse(res.stdout);
  return files.map((f) => f.path);
}

test('packages/core/package.json exports ./typed-contracts pointing at a file that exists', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(CORE_DIR, 'package.json'), 'utf8'));
  const entry = pkg.exports['./typed-contracts'];
  assert.ok(entry, 'exports["./typed-contracts"] should exist');
  const targets = typeof entry === 'string' ? [entry] : Object.values(entry);
  assert.ok(targets.length > 0);
  for (const target of targets) {
    assert.ok(fs.existsSync(path.join(CORE_DIR, target)), `${target} should exist on disk`);
  }
});

test('npm pack --dry-run ships every typed-contracts factory source, and excludes examples/tsconfig', () => {
  const files = packDryRun();
  for (const f of EXPECTED_TYPED_CONTRACTS_FILES) {
    assert.ok(files.includes(f), `${f} should be in the packed file list`);
  }
  assert.ok(!files.some((f) => f.startsWith('typed-contracts/examples/')), 'examples/ (test fixtures) should not ship');
  assert.ok(!files.includes('typed-contracts/tsconfig.json'), 'the dev-only tsconfig should not ship');
});

/**
 * Build node_modules/@line/construct-core in `dir` from EXACTLY the packed file list -- a file
 * present in the `files` array on disk but missing from what npm would actually publish fails
 * here, same as it would for a real `npm install` from the registry.
 */
function installFromPack(dir) {
  const files = packDryRun();
  const dest = path.join(dir, 'node_modules', '@line', 'construct-core');
  for (const rel of files) {
    const src = path.join(CORE_DIR, rel);
    const out = path.join(dest, rel);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.copyFileSync(src, out);
  }
  return dest;
}

test('Node\'s own resolution algorithm resolves @line/construct-core/typed-contracts from a fixture install (no registry)', () => {
  const dir = makeTempDir('construct-typed-contracts-resolve-');
  installFromPack(dir);
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'consumer', type: 'module', private: true }));
  const entry = path.join(dir, 'resolve.mjs');
  fs.writeFileSync(entry, 'console.log(import.meta.resolve(\'@line/construct-core/typed-contracts\'));\n');
  const res = spawnSync(process.execPath, [entry], { cwd: dir, encoding: 'utf8' });
  assert.equal(res.status, 0, `import.meta.resolve failed:\n${res.stderr}`);
  const resolvedUrl = res.stdout.trim();
  assert.match(resolvedUrl, /typed-contracts\/index\.ts$/);
  const resolvedPath = fileURLToPath(resolvedUrl);
  assert.ok(fs.existsSync(resolvedPath), `resolved path ${resolvedPath} should exist`);
  // The resolved index.ts's own relative imports (./template.ts, ./units.ts, ...) must also be
  // present -- a generated unit imports defineDomain etc., which pulls in the whole barrel.
  for (const f of ['template.ts', 'units.ts', 'brand.ts', 'factories.ts', 'schema.ts']) {
    assert.ok(fs.existsSync(path.join(path.dirname(resolvedPath), f)), `${f} should sit next to index.ts`);
  }
});

test('a real tsc (moduleResolution: bundler, the setting construct init scaffolds) consumes the published package by specifier, not relative path', () => {
  const dir = makeTempDir('construct-typed-contracts-tsc-');
  installFromPack(dir);
  // react's types are a real dependency of typed-contracts (factories.ts imports `ReactNode`);
  // a scaffolded project already has these as devDependencies (packages/core/scaffold.mjs's
  // REACT_TYPES). Reuse the repo's own copies rather than duplicating node_modules/react.
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules', 'react'), path.join(dir, 'node_modules', 'react'));
  fs.mkdirSync(path.join(dir, 'node_modules', '@types'), { recursive: true });
  fs.symlinkSync(path.join(REPO_ROOT, 'node_modules', '@types', 'react'), path.join(dir, 'node_modules', '@types', 'react'));

  const fixture = path.join(dir, 'unit.ts');
  fs.writeFileSync(
    fixture,
    [
      "import { defineDomain } from '@line/construct-core/typed-contracts';",
      '',
      "const total = defineDomain<{ items: number[] }, number>('total', ({ items }) => items.reduce((a, b) => a + b, 0));",
      '',
      'export { total };',
      '',
    ].join('\n'),
  );
  // A real scaffolded project (packages/core/scaffold.mjs's react-spa/nextjs templates) always
  // has at least one real .tsx entry file (src/App.tsx, app/layout.tsx); that real JSX syntax is
  // what makes tsc synthesize the global `JSX` namespace merge for the whole program (see
  // packages/core/typed-contracts/jsx-global.d.ts's doc comment) -- so this fixture includes one
  // too, rather than depending on that package-internal shim a consumer would not know to import.
  const jsxFixture = path.join(dir, 'App.tsx');
  fs.writeFileSync(jsxFixture, "export function App() {\n  return <div>hi</div>;\n}\n");

  try {
    const output = execFileSync(
      TSC,
      [
        '--noEmit', '--strict', '--noImplicitReturns',
        '--target', 'ES2022', '--module', 'ES2022', '--moduleResolution', 'bundler',
        '--jsx', 'react-jsx', '--skipLibCheck', '--allowImportingTsExtensions',
        '--typeRoots', path.join(REPO_ROOT, 'node_modules', '@types'),
        '--types', 'react,node',
        fixture, jsxFixture,
      ],
      { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    );
    assert.equal(output.trim(), '');
  } catch (e) {
    assert.fail(`expected the fixture unit to compile clean against the published package; tsc said:\n${e.stdout || ''}${e.stderr || ''}`);
  }
});
