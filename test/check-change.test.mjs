// #747 -- `construct check-change` (packages/core/check-change.mjs): the CLI/block wrapper around
// packages/ast's semanticDiff, comparing an unsaved working-tree edit against its content at HEAD.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeTempDir } from '../test-utils/tmpdir.mjs';
import { checkChangeForFile, checkChangeBlock } from '../packages/core/check-change.mjs';
import { ConstructError } from '../packages/core/diagnostics.mjs';
import { runBlock } from '../packages/core/block-contract.mjs';

const ID = ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false'];
const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });

function repoWithFile(relPath, content) {
  const dir = makeTempDir('construct-check-change-');
  git(dir, 'init', '-q', '-b', 'main');
  const abs = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  git(dir, 'add', '-A');
  git(dir, ...ID, 'commit', '-q', '-m', 'init');
  return dir;
}

test('unsaved edit that only renames: same-behaviour, renamed', () => {
  const root = repoWithFile('total.ts', 'export function add(a, b) { return a + b; }\n');
  fs.writeFileSync(path.join(root, 'total.ts'), 'export function sum(x, y) { return x + y; }\n');
  assert.deepEqual(checkChangeForFile(root, 'total.ts'), { file: 'total.ts', verdict: 'same-behaviour', operations: ['renamed'] });
});

test('unsaved edit that changes logic: changed, with a propertyCheck section (#749)', () => {
  const root = repoWithFile('total.ts', 'export const total = (a, b) => a + b;\n');
  fs.writeFileSync(path.join(root, 'total.ts'), 'export const total = (a, b) => a - b;\n');
  assert.deepEqual(checkChangeForFile(root, 'total.ts'), {
    file: 'total.ts',
    verdict: 'changed',
    operations: ['changed'],
    // Untyped parameters: pureExportEquivalence can't choose an arbitrary, so it's skipped rather than guessed at.
    propertyCheck: { checked: [], skipped: [{ name: 'total', reason: 'unsupported parameter types' }] },
  });
});

test('unsaved edit that changes logic on typed pure parameters: propertyCheck reports the counter-example (#749)', () => {
  const root = repoWithFile('total.ts', 'export const total = (a: number, b: number) => a + b;\n');
  fs.writeFileSync(path.join(root, 'total.ts'), 'export const total = (a: number, b: number) => a - b;\n');
  const result = checkChangeForFile(root, 'total.ts');
  assert.equal(result.verdict, 'changed');
  assert.equal(result.propertyCheck.checked.length, 1);
  assert.equal(result.propertyCheck.checked[0].name, 'total');
  assert.equal(result.propertyCheck.checked[0].verdict, 'diverged');
  assert.ok(Array.isArray(result.propertyCheck.checked[0].input));
});

test('no unsaved edit: same-behaviour, no operations', () => {
  const root = repoWithFile('total.ts', 'export const total = (a, b) => a + b;\n');
  assert.deepEqual(checkChangeForFile(root, 'total.ts'), { file: 'total.ts', verdict: 'same-behaviour', operations: [] });
});

test('a file not present at the ref (new, uncommitted file): cant-tell', () => {
  const root = repoWithFile('README.md', 'hi\n');
  fs.writeFileSync(path.join(root, 'new.ts'), 'export const x = 1;\n');
  const result = checkChangeForFile(root, 'new.ts');
  assert.equal(result.verdict, 'cant-tell');
  assert.match(result.reason, /new file/);
});

test('a working-tree file that does not exist throws a usage-shaped ConstructError', () => {
  const root = repoWithFile('README.md', 'hi\n');
  assert.throws(() => checkChangeForFile(root, 'missing.ts'), (err) => err instanceof ConstructError && err.exitCode === 2);
});

test('checkChangeBlock is a valid, read-only block-contract block that surfaces its result via ctx', async () => {
  assert.equal(checkChangeBlock.writes, false);
  const root = repoWithFile('total.ts', 'export const total = (a, b) => a + b;\n');
  fs.writeFileSync(path.join(root, 'total.ts'), 'export const total = (a, b) => a - b;\n');
  const ctx = { root };
  const { changedFiles } = await runBlock(checkChangeBlock, { file: 'total.ts' }, ctx);
  assert.deepEqual(changedFiles, []);
  assert.equal(ctx.lastResult.verdict, 'changed');
});
