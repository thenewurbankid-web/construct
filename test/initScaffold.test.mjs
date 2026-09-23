// #497: `construct init` scaffolds a runnable project shell (package.json, tsconfig, bundler config,
// .gitignore, ...) for the chosen framework; never overwrites; `--no-scaffold` opts out.
// No npm install here: shape checks only (JSON parse, `node --check`, cross-file references).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXIT_CODES } from '../packages/core/diagnostics.mjs';
import { scaffoldProject, SCAFFOLD_FRAMEWORKS } from '../packages/core/scaffold.mjs';
import { makeTempDir } from '../test-utils/tmpdir.mjs';

const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'cli', 'construct.mjs');
const run = (args, cwd) => spawnSync('node', [bin, ...args], { encoding: 'utf8', cwd });
const readJson = (dir, rel) => JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8'));
const has = (dir, rel) => fs.existsSync(path.join(dir, rel));

const SHELL = {
  'react-spa': ['package.json', 'tsconfig.json', 'vite.config.ts', 'index.html', 'src/vite-env.d.ts', '.gitignore'],
  nextjs: ['package.json', 'tsconfig.json', 'next.config.mjs', 'next-env.d.ts', 'app/layout.tsx', '.gitignore'],
};

test('every scaffold template is covered by SHELL (a new file or framework must be asserted here)', () => {
  assert.deepEqual([...SCAFFOLD_FRAMEWORKS].sort(), Object.keys(SHELL).sort());
});

test('init --framework react-spa scaffolds a Vite + React shell that agrees with the entry files', () => {
  const dir = makeTempDir('construct-scaffold-');
  const res = run(['init', '--framework', 'react-spa'], dir);
  assert.equal(res.status, EXIT_CODES.OK);
  for (const f of SHELL['react-spa']) assert.ok(has(dir, f), `${f} should exist`);
  const pkg = readJson(dir, 'package.json');
  assert.deepEqual(Object.keys(pkg.scripts).sort(), ['build', 'dev', 'preview', 'test:unit']);
  assert.equal(pkg.scripts.dev, 'vite');
  assert.equal(pkg.scripts['test:unit'], 'tsx --test "features/**/tests/generated/*.test.ts"'); // #583: runs `construct generate tests --unit` output
  for (const d of ['react', 'react-dom', 'react-router-dom', 'xstate']) assert.ok(pkg.dependencies[d], `dependency ${d}`);
  for (const d of ['vite', '@vitejs/plugin-react', 'typescript', '@types/react', '@types/react-dom', '@types/node', '@xstate/graph', 'tsx']) assert.ok(pkg.devDependencies[d], `devDependency ${d}`);
  assert.equal(pkg.name, path.basename(dir).toLowerCase().replace(/[^a-z0-9._~-]+/g, '-').replace(/^[-._]+|-+$/g, ''));
  assert.deepEqual(readJson(dir, 'tsconfig.json').include, ['src', 'features', 'vite.config.ts']);
  assert.equal(readJson(dir, 'tsconfig.json').compilerOptions.jsx, 'react-jsx');
  // index.html boots the entry file init already writes.
  const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
  assert.match(html, /<script type="module" src="\/src\/main\.tsx">/);
  assert.match(html, /<div id="root">/);
  assert.ok(has(dir, 'src/main.tsx'));
  assert.match(fs.readFileSync(path.join(dir, 'vite.config.ts'), 'utf8'), /plugin-react/);
  assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /^node_modules$/m);
  assert.match(res.stdout, /npm install && npm run dev/);
  assert.match(res.stdout, /Scaffolded 6 project file\(s\)/);
});

test('init (default nextjs) scaffolds a Next App Router shell with create-next-app style config', () => {
  const dir = makeTempDir('construct-scaffold-');
  const res = run(['init'], dir);
  assert.equal(res.status, EXIT_CODES.OK);
  for (const f of SHELL.nextjs) assert.ok(has(dir, f), `${f} should exist`);
  const pkg = readJson(dir, 'package.json');
  assert.deepEqual(pkg.scripts, { dev: 'next dev', build: 'next build', start: 'next start', 'test:unit': 'tsx --test "features/**/tests/generated/*.test.ts"' });
  for (const d of ['next', 'react', 'react-dom', 'xstate']) assert.ok(pkg.dependencies[d], `dependency ${d}`);
  for (const d of ['typescript', '@types/node', '@types/react', '@types/react-dom', '@xstate/graph', 'tsx']) assert.ok(pkg.devDependencies[d], `devDependency ${d}`);
  const ts = readJson(dir, 'tsconfig.json');
  assert.equal(ts.compilerOptions.jsx, 'preserve');
  assert.ok(ts.include.includes('next-env.d.ts'));
  assert.match(fs.readFileSync(path.join(dir, 'app', 'layout.tsx'), 'utf8'), /export default function RootLayout/);
  assert.match(fs.readFileSync(path.join(dir, 'next-env.d.ts'), 'utf8'), /reference types="next"/);
  assert.match(res.stdout, /npm install && npm run dev/);
});

test('scaffolded .mjs config parses (node --check)', () => {
  const dir = makeTempDir('construct-scaffold-');
  run(['init'], dir);
  const check = spawnSync('node', ['--check', path.join(dir, 'next.config.mjs')], { encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr);
});

test('scaffolded project does not add violations: validate reports only the known forward import + READ-003', () => {
  for (const framework of Object.keys(SHELL)) {
    const dir = makeTempDir('construct-scaffold-');
    run(['init', '--framework', framework], dir);
    const res = run(['validate', '--format', 'json'], dir);
    const violations = JSON.parse(res.stdout).violations;
    const entry = framework === 'nextjs' ? 'app/page.tsx' : 'src/App.tsx';
    assert.deepEqual(violations.map((v) => `${v.rule}@${v.file}`).sort(), [`IMPORT-001@${entry}`, 'READ-003@features/core/index.ts'], framework);
  }
});

test('init never overwrites an existing file and reports what it kept', () => {
  const dir = makeTempDir('construct-scaffold-');
  const mine = '{"name":"mine","scripts":{"dev":"custom"}}\n';
  fs.writeFileSync(path.join(dir, 'package.json'), mine);
  fs.writeFileSync(path.join(dir, 'tsconfig.json'), '// mine\n{}\n');
  fs.writeFileSync(path.join(dir, '.gitignore'), 'mine\n');
  const res = run(['init', '--framework', 'react-spa'], dir);
  assert.equal(res.status, EXIT_CODES.OK);
  assert.equal(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'), mine);
  assert.equal(fs.readFileSync(path.join(dir, 'tsconfig.json'), 'utf8'), '// mine\n{}\n');
  assert.equal(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), 'mine\n');
  assert.match(res.stdout, /Kept existing \(not overwritten\): package\.json, tsconfig\.json, \.gitignore/);
  assert.ok(has(dir, 'vite.config.ts'), 'files that did not exist are still written');
  assert.doesNotMatch(res.stdout, /npm install && npm run dev/, 'no "run it" hint when package.json is the user\'s own');
});

test('init --no-scaffold writes only the Construct files', () => {
  for (const framework of Object.keys(SHELL)) {
    const dir = makeTempDir('construct-scaffold-');
    const res = run(['init', '--framework', framework, '--no-scaffold'], dir);
    assert.equal(res.status, EXIT_CODES.OK);
    for (const f of SHELL[framework]) assert.ok(!has(dir, f), `${f} should not exist`);
    assert.ok(has(dir, 'architecture.yml'));
    assert.doesNotMatch(res.stdout, /Scaffolded/);
  }
});

test('init [dir] scaffolds into the target dir and names the package after it', () => {
  const parent = makeTempDir('construct-scaffold-');
  const res = run(['init', 'My App', '--framework', 'react-spa'], parent);
  assert.equal(res.status, EXIT_CODES.OK);
  assert.equal(readJson(path.join(parent, 'My App'), 'package.json').name, 'my-app');
  assert.match(res.stdout, /cd "My App" && npm install/);
});

test('init --help prints usage (mentioning --no-scaffold) and writes nothing', () => {
  const dir = makeTempDir('construct-scaffold-');
  const res = run(['init', '--help'], dir);
  assert.equal(res.status, EXIT_CODES.OK);
  assert.match(res.stdout, /--no-scaffold/);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('scaffoldProject skips existing files and is idempotent', () => {
  const dir = makeTempDir('construct-scaffold-');
  const first = scaffoldProject(dir, 'nextjs');
  assert.deepEqual(first.written.sort(), [...SHELL.nextjs].sort());
  const second = scaffoldProject(dir, 'nextjs');
  assert.deepEqual(second.written, []);
  assert.deepEqual(second.skipped.sort(), [...SHELL.nextjs].sort());
});
