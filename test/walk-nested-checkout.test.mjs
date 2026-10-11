// `construct validate --dir fixtures/architecture-invalid` in the main checkout crashed with "Maximum call
// stack size exceeded": the fixture has no config, so the root climbed to the repo's leftover architecture.yml,
// and walk() then spread the file list of the whole repo, ~40 nested git worktrees under .claude/worktrees
// included, into one push(...). These pin the three fixes: walk never spreads, walk skips a nested checkout,
// and --dir on a folder with its own features/ validates that folder, not a parent's project.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { walk, rel } from '../packages/core/fs.mjs';
import { findProjectRoot, resolveDirRoot } from '../packages/core/config.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(here, '..');
const CLI = path.join(REPO, 'packages', 'cli', 'construct.mjs');
const FS_MODULE = path.join(REPO, 'packages', 'core', 'fs.mjs');

const touch = (file, text = '') => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); };

test('walk skips a nested checkout (a .git file or folder) below the root, and keeps every other file in order', () => {
  const root = makeTempDir('walk-nested-');
  fs.mkdirSync(path.join(root, '.git'));
  touch(path.join(root, 'a.ts'));
  touch(path.join(root, 'features', 'plan', 'pages', 'Plan.tsx'));
  touch(path.join(root, 'node_modules', 'x', 'index.js'));
  touch(path.join(root, '.next', 'cache.json'));
  const worktree = path.join(root, '.claude', 'worktrees', 'agent-1');
  touch(path.join(worktree, '.git'), 'gitdir: /elsewhere\n');
  for (let i = 0; i < 2000; i++) touch(path.join(worktree, 'features', `f${i % 20}`, `File${i}.ts`));
  const clone = path.join(root, 'vendor', 'clone');
  fs.mkdirSync(path.join(clone, '.git'), { recursive: true });
  touch(path.join(clone, 'index.ts'));
  touch(path.join(root, 'z.ts'));

  const files = walk(root).map((p) => rel(root, p));
  assert.deepEqual(files.sort(), ['a.ts', 'features/plan/pages/Plan.tsx', 'z.ts']);
  assert.equal(walk(worktree).length, 2000, 'walking the checkout itself still lists it');
});

test('walk lists a large flat folder without overflowing the call stack (no spread push)', () => {
  const root = makeTempDir('walk-large-');
  const big = path.join(root, 'a', 'b');
  fs.mkdirSync(big, { recursive: true });
  const n = 20000;
  for (let i = 0; i < n; i++) fs.writeFileSync(path.join(big, `f${i}`), '');
  // A small stack makes the old `out.push(...walk(p))` overflow at this size (it did at --stack-size=100 with
  // 12000 files), so the test stays fast while still guarding the regression.
  const src = `import { walk } from ${JSON.stringify(FS_MODULE)}; console.log(walk(process.argv[1]).length);`;
  const r = spawnSync(process.execPath, ['--stack-size=80', '--input-type=module', '-e', src, root], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), String(n));
});

test('findProjectRoot stops at a checkout boundary instead of inheriting the enclosing repo config', () => {
  const root = makeTempDir('root-boundary-');
  touch(path.join(root, 'architecture.yml'), 'rules: {}\n');
  const worktree = path.join(root, '.claude', 'worktrees', 'w1');
  touch(path.join(worktree, '.git'), 'gitdir: /elsewhere\n');
  fs.mkdirSync(path.join(worktree, 'src'), { recursive: true });
  assert.equal(findProjectRoot(path.join(worktree, 'src')), null);
  touch(path.join(worktree, 'architecture.yml'), 'rules: {}\n');
  assert.equal(findProjectRoot(path.join(worktree, 'src')), worktree, 'the checkout top itself is still checked');
  assert.equal(findProjectRoot(path.join(root, 'features', 'x')), root, 'a plain subfolder still climbs (monorepo)');
});

test('resolveDirRoot: its own config or its own features/ wins; a plain subfolder climbs to the project', () => {
  const root = makeTempDir('dir-root-');
  touch(path.join(root, 'architecture.yml'), 'rules: {}\n');
  touch(path.join(root, 'features', 'plan', 'pages', 'Plan.tsx'));
  touch(path.join(root, 'fixtures', 'unsynced', 'features', 'a', 'pages', 'A.tsx'));
  touch(path.join(root, 'tools', 'construct', 'architecture.yml'), 'rules: {}\n');
  assert.equal(resolveDirRoot(path.join(root, 'features', 'plan')), root);
  assert.equal(resolveDirRoot(path.join(root, 'fixtures', 'unsynced')), path.join(root, 'fixtures', 'unsynced'));
  assert.equal(resolveDirRoot(path.join(root, 'tools', 'construct')), path.join(root, 'tools', 'construct'));
});

test('validate --dir <fixture without config> inside a repo with a parent architecture.yml validates the fixture', () => {
  const fixture = path.join(REPO, 'fixtures', 'architecture-invalid');
  // The baseline: the fixture validated on its own, with no parent config anywhere above it.
  const alone = makeTempDir('dir-alone-');
  fs.cpSync(fixture, alone, { recursive: true });
  const base = spawnSync(process.execPath, [CLI, 'validate', '--format', 'json', '--dir', alone], { encoding: 'utf8' });
  assert.equal(base.stderr, '');

  // The same fixture inside a repo whose root holds an architecture.yml, a parent-only violation and a big
  // nested worktree: before the fix this validated the parent and overflowed the stack on the real repo.
  const repo = makeTempDir('dir-repo-');
  fs.mkdirSync(path.join(repo, '.git'));
  fs.copyFileSync(path.join(REPO, 'architecture.yml'), path.join(repo, 'architecture.yml'));
  touch(path.join(repo, 'features', 'parentonly', 'pages', 'Bad.tsx'), 'export default function Bad(){ fetch("/x"); return null }\n');
  const worktree = path.join(repo, '.claude', 'worktrees', 'agent-1');
  touch(path.join(worktree, '.git'), 'gitdir: /elsewhere\n');
  for (let i = 0; i < 500; i++) touch(path.join(worktree, 'features', 'w', 'pages', `P${i}.tsx`), 'export default function P(){ return null }\n');
  const inside = path.join(repo, 'fixtures', 'architecture-invalid');
  fs.cpSync(fixture, inside, { recursive: true });

  const r = spawnSync(process.execPath, [CLI, 'validate', '--format', 'json', '--dir', inside], { encoding: 'utf8' });
  assert.doesNotMatch(r.stderr, /Maximum call stack/);
  assert.equal(r.stderr, '');
  assert.equal(r.status, base.status);
  assert.equal(r.stdout, base.stdout, 'the fixture is validated as given, not the enclosing repo');
  assert.doesNotMatch(r.stdout, /parentonly|worktrees/);
});
