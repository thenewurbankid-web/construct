#!/usr/bin/env node
// `npm test`: Node's own test runner over the repo's test files, minus every folder below the root that is another git
// checkout (a nested clone, a worktree, a submodule: anything with its own `.git` entry). A bare `node --test` globs
// every *.test.* under the root, untracked nested copies included, which is how a stray copy hung the suite for hours.
//
//   node packages/tools/dev/run-tests.mjs [node --test flags...]   run them (flags pass through)
//   node packages/tools/dev/run-tests.mjs --list                    print the files, one per line
//   node packages/tools/dev/run-tests.mjs --install-dirs            print the folders that need `npm ci` (#853)
//
// Before running anything it checks that each of those folders has its node_modules, and stops with the one command to
// fix it if not (#853): otherwise a fresh checkout reports ~100 false failures.
//
// The files are the ones `node --test` would find by its default patterns (Node docs, "Running tests from the command
// line"), with TypeScript's extensions as Node 24 strips types by default; the walk is core fs.mjs `walk` (skips
// node_modules, .next, .git and nested checkouts).
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { walk, rel } from '../../core/fs.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const EXT = '(c|m)?(j|t)s';
const PATTERNS = [
  new RegExp(`(^|/)[^/]*\\.test\\.${EXT}$`), new RegExp(`(^|/)[^/]*-test\\.${EXT}$`), new RegExp(`(^|/)[^/]*_test\\.${EXT}$`),
  new RegExp(`(^|/)test-[^/]*\\.${EXT}$`), new RegExp(`(^|/)test\\.${EXT}$`), new RegExp(`(^|/)test/(.*/)?[^/]*\\.${EXT}$`),
];

/**
 * The test files `node --test` would run from `root`, without nested checkouts.
 * @param {string} [root]
 * @returns {string[]} Root-relative, sorted.
 */
export function testFiles(root = ROOT) {
  // Like node's glob: no dot folders or dot files. Unlike it, no `fixtures` folder: `test/**/*.ts` would run a test
  // fixture's .ts source as a test file (two fixtures that import what is not there failed the suite).
  // A SUBSUITES folder runs its own `npm test` instead (below), so none of its files are globbed.
  return walk(root).map((f) => rel(root, f))
    .filter((f) => !SUBSUITES.some((d) => f.startsWith(`${d}/`)))
    .filter((f) => !f.split('/').some((s) => s.startsWith('.') || s === 'fixtures') && PATTERNS.some((p) => p.test(f))).sort();
}

/**
 * Workspace packages whose tests need a build step first, so `npm test` runs each one's own `npm test` after the
 * globbed files, one at a time. Smith (packages/line-smith) compiles with TypeScript 7 before its tests import dist/,
 * and its test/types/*.ts are tsc fixtures, not test files.
 */
export const SUBSUITES = ['packages/line-smith'];

/**
 * Every folder whose own dependencies the suite imports (#853). A fresh checkout without `npm ci` in each one does
 * not fail cleanly: ~104 tests fail on a missing module, which reads like real breakage. Kept here as the one list
 * both the fail-fast check below and packages/tools/dev/install-all.sh read (`--install-dirs`).
 */
export const INSTALL_DIRS = ['.', 'ui/server', 'trace', 'trace/demo-app', 'trace/subframe-app'];

/** The one command that installs every folder in INSTALL_DIRS. */
export const INSTALL_COMMAND = 'npm run install:all';

/**
 * The INSTALL_DIRS folders under `root` that have a package.json but no node_modules. A node_modules that is a
 * symlink (a worktree linked to the main checkout's install) counts as present when it resolves to a directory;
 * a dangling one is missing.
 * @param {string} [root]
 * @returns {string[]} Root-relative, in INSTALL_DIRS order.
 */
export function missingInstalls(root = ROOT) {
  const isDir = (p) => { try { return fs.statSync(p).isDirectory(); } catch { return false; } };
  return INSTALL_DIRS.filter((d) => fs.existsSync(path.join(root, d, 'package.json')) && !isDir(path.join(root, d, 'node_modules')));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.includes('--install-dirs')) { process.stdout.write(`${INSTALL_DIRS.join('\n')}\n`); process.exit(0); }
  const files = testFiles();
  if (args.includes('--list')) { process.stdout.write(`${files.join('\n')}\n`); process.exit(0); }
  const missing = missingInstalls();
  if (missing.length) {
    process.stderr.write([
      'npm test: dependencies are not installed in:',
      ...missing.map((d) => `  ${d === '.' ? '. (repo root)' : d}`),
      'Without them ~100 tests fail on a missing module, not on a real bug. Install every folder in one step:',
      `  ${INSTALL_COMMAND}`,
      '(in a git worktree, packages/tools/dev/link-worktree-node-modules.sh links the main checkout\'s instead)',
      '',
    ].join('\n'));
    process.exit(1);
  }
  const r = spawnSync(process.execPath, ['--test', ...args, ...files], { cwd: ROOT, stdio: 'inherit' });
  let status = r.status ?? 1;
  for (const dir of SUBSUITES) {
    process.stdout.write(`\n# npm test: ${dir} (its own suite)\n`);
    const s = spawnSync('npm', ['test'], { cwd: path.join(ROOT, dir), stdio: 'inherit' });
    if ((s.status ?? 1) !== 0) status = status || (s.status ?? 1);
  }
  process.exit(status);
}
