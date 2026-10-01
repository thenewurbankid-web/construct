import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { pageChangedVsMain } from './pagesGitStatus.mjs';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..', '..');
const SHARED = path.join(REPO, 'fixtures', 'impact-shared');

function git(cwd, ...args) {
  execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' });
}

function makeRepo() {
  const dir = makeTempDir('pages-git-status-');
  fs.cpSync(SHARED, dir, { recursive: true });
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'base');
  return dir;
}

test('pageChangedVsMain: no repo at all is reported as not changed, never an error', () => {
  const dir = makeTempDir('pages-git-status-norepo-');
  fs.cpSync(SHARED, dir, { recursive: true });
  const r = pageChangedVsMain(dir, 'billing', 'BillingPage.tsx');
  assert.deepEqual(r, { ok: true, path: 'features/billing/pages/BillingPage.tsx', changed: false });
});

test('pageChangedVsMain: unchanged since main', () => {
  const dir = makeRepo();
  const r = pageChangedVsMain(dir, 'billing', 'BillingPage.tsx');
  assert.equal(r.ok, true);
  assert.equal(r.changed, false);
});

test('pageChangedVsMain: an uncommitted edit is "changed", before any commit exists', () => {
  const dir = makeRepo();
  const p = path.join(dir, 'features/billing/pages/BillingPage.tsx');
  fs.writeFileSync(p, `${fs.readFileSync(p, 'utf8')}\n// edited`);
  const r = pageChangedVsMain(dir, 'billing', 'BillingPage.tsx');
  assert.equal(r.changed, true);
});

test('pageChangedVsMain: works through a symlinked root (macOS /var -> /private/var tmpdir shape)', () => {
  // Regression for the bug the e2e spec caught: ui/server/src/git.mjs's own isRepo() compares
  // `path.resolve(root)` against git's resolved `--show-toplevel`, which never match when `root`
  // itself is reached through a symlink -- exactly `os.tmpdir()`'s shape on macOS. This function
  // must not use that check.
  const real = makeRepo();
  const link = `${real}-link`;
  fs.symlinkSync(real, link);
  try {
    const r = pageChangedVsMain(link, 'billing', 'BillingPage.tsx');
    assert.equal(r.ok, true);
    assert.equal(r.changed, false);
  } finally {
    fs.unlinkSync(link);
  }
});

test('pageChangedVsMain: a real commit on a session branch past main is "changed"', () => {
  const dir = makeRepo();
  git(dir, 'checkout', '-q', '-b', 'session');
  const p = path.join(dir, 'features/billing/pages/BillingPage.tsx');
  fs.writeFileSync(p, `${fs.readFileSync(p, 'utf8')}\n// edited`);
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'edit');
  const r = pageChangedVsMain(dir, 'billing', 'BillingPage.tsx');
  assert.equal(r.changed, true);

  // A different, untouched page on the same session branch is still unchanged vs main.
  const other = pageChangedVsMain(dir, 'checkout', 'CheckoutPage.tsx');
  assert.equal(other.changed, false);
});
