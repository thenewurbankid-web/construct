#!/usr/bin/env node
// `npm test`: Node's own test runner over the repo's test files, minus every folder below the root that is another git
// checkout (a nested clone, a worktree, a submodule: anything with its own `.git` entry). A bare `node --test` globs
// every *.test.* under the root, untracked nested copies included, which is how a stray copy hung the suite for hours.
//
//   node packages/tools/dev/run-tests.mjs [node --test flags...]   run them (flags pass through)
//   node packages/tools/dev/run-tests.mjs --list                    print the files, one per line
//
// The files are the ones `node --test` would find by its default patterns (Node docs, "Running tests from the command
// line"), with TypeScript's extensions as Node 24 strips types by default; the walk is core fs.mjs `walk` (skips
// node_modules, .next, .git and nested checkouts).
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
  // Like node's glob: no dot folders or dot files.
  return walk(root).map((f) => rel(root, f)).filter((f) => !f.split('/').some((s) => s.startsWith('.')) && PATTERNS.some((p) => p.test(f))).sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const files = testFiles();
  if (args.includes('--list')) { process.stdout.write(`${files.join('\n')}\n`); process.exit(0); }
  const r = spawnSync(process.execPath, ['--test', ...args, ...files], { cwd: ROOT, stdio: 'inherit' });
  process.exit(r.status ?? 1);
}
