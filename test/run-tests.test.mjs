// `npm test` (packages/tools/dev/run-tests.mjs): node --test's own file patterns, minus nested git checkouts.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { testFiles, missingInstalls, INSTALL_DIRS } from '../packages/tools/dev/run-tests.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A throwaway repo root holding a copy of run-tests.mjs (its ROOT is wherever it sits) plus install-all.sh, with
 * packages/core linked to the real one for its import. `pkgs` get a package.json; `installed` a node_modules
 * folder; `linked` a node_modules symlink to a real folder elsewhere.
 */
function fakeRepo({ pkgs = [], installed = [], linked = [], dangling = [] }) {
  const root = makeTempDir('construct-run-tests-deps-');
  const dev = path.join(root, 'packages/tools/dev');
  fs.mkdirSync(dev, { recursive: true });
  for (const f of ['run-tests.mjs', 'install-all.sh', 'heavy.sh']) fs.copyFileSync(path.join(REPO, 'packages/tools/dev', f), path.join(dev, f));
  fs.symlinkSync(path.join(REPO, 'packages/core'), path.join(root, 'packages/core'));
  const shared = makeTempDir('construct-run-tests-shared-');
  for (const d of pkgs) { fs.mkdirSync(path.join(root, d), { recursive: true }); fs.writeFileSync(path.join(root, d, 'package.json'), '{}'); }
  for (const d of installed) fs.mkdirSync(path.join(root, d, 'node_modules'), { recursive: true });
  for (const d of linked) fs.symlinkSync(shared, path.join(root, d, 'node_modules'));
  for (const d of dangling) fs.symlinkSync(path.join(shared, 'gone'), path.join(root, d, 'node_modules'));
  return root;
}

test('npm test: node --test\'s default patterns, with no nested checkout, dot folder, test fixture or node_modules', () => {
  const root = makeTempDir('construct-run-tests-');
  const put = (rel) => { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), ''); };
  for (const f of ['a.test.mjs', 'b-test.js', 'c_test.cjs', 'test-d.mjs', 'test.js', 'test/helpers/e.mjs', 'f.test.ts', 'src/g.spec.mjs', 'h.mjs']) put(f);
  put('copy/.git/HEAD'); put('copy/x.test.mjs');
  put('wt/.git'); put('wt/y.test.mjs');
  put('.claude/z.test.mjs');
  put('node_modules/pkg/w.test.mjs');
  put('test/fixtures/app/src/hook.ts');
  assert.deepEqual(testFiles(root), ['a.test.mjs', 'b-test.js', 'c_test.cjs', 'f.test.ts', 'test-d.mjs', 'test.js', 'test/helpers/e.mjs']);
});

// ---- #853: a fresh checkout without `npm ci` everywhere stops with the fix, not ~104 false failures ----

test('#853 the folders npm test needs installed are the root, ui/server and the three trace apps', () => {
  assert.deepEqual(INSTALL_DIRS, ['.', 'ui/server', 'trace', 'trace/demo-app', 'trace/subframe-app']);
});

test('#853 missingInstalls: package.json without node_modules is missing; a real or symlinked node_modules is present', () => {
  const root = fakeRepo({
    pkgs: ['.', 'ui/server', 'trace', 'trace/demo-app', 'trace/subframe-app'],
    installed: ['ui/server'],
    linked: ['.', 'trace'],
    dangling: ['trace/demo-app'],
  });
  assert.deepEqual(missingInstalls(root), ['trace/demo-app', 'trace/subframe-app'], 'a dangling symlink is missing; a folder with no package.json is never asked about');
  const none = fakeRepo({ pkgs: ['.'], installed: ['.'] });
  assert.deepEqual(missingInstalls(none), [], 'folders with no package.json (ui/server, trace...) are not required');
});

test('#853 npm test stops before running anything, lists every missing folder and the one command to fix it', () => {
  const root = fakeRepo({ pkgs: ['.', 'ui/server', 'trace'], installed: ['.'] });
  fs.writeFileSync(path.join(root, 'must-not-run.test.mjs'), 'import { writeFileSync } from "node:fs"; writeFileSync(import.meta.filename + ".ran", "");');
  const r = spawnSync(process.execPath, [path.join(root, 'packages/tools/dev/run-tests.mjs')], { cwd: root, encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stderr, /dependencies are not installed in:\n {2}ui\/server\n {2}trace\n/);
  assert.match(r.stderr, /npm run install:all/);
  assert.equal(fs.existsSync(path.join(root, 'must-not-run.test.mjs.ran')), false, 'no test ran');
  // --list and --install-dirs still work without the install.
  const list = spawnSync(process.execPath, [path.join(root, 'packages/tools/dev/run-tests.mjs'), '--install-dirs'], { encoding: 'utf8' });
  assert.equal(list.status, 0, list.stderr);
  assert.deepEqual(list.stdout.trim().split('\n'), INSTALL_DIRS);
});

test('#853 install-all.sh --dry-run: npm ci in every folder with a package.json, skipping shared symlinked installs', () => {
  const root = fakeRepo({ pkgs: ['.', 'ui/server', 'trace', 'trace/subframe-app'], installed: ['.'], linked: ['trace'] });
  const r = spawnSync('bash', [path.join(root, 'packages/tools/dev/install-all.sh'), '--dry-run'], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split('\n'), [
    'install-all: .: npm ci',
    'install-all: ui/server: npm ci',
    'install-all: skip trace (node_modules is a symlink to a shared install)',
    'install-all: skip trace/demo-app (no package.json)',
    'install-all: trace/subframe-app: npm ci',
  ]);
  assert.equal(spawnSync('bash', [path.join(root, 'packages/tools/dev/install-all.sh'), '--bogus']).status, 2, 'usage');
});

test('#853 the root package.json has the one-step installer script the error message names', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(REPO, 'package.json'), 'utf8'));
  assert.equal(pkg.scripts['install:all'], 'bash packages/tools/dev/install-all.sh');
});
