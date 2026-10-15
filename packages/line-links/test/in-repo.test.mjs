// t0-6: Smith and atomic-codemod default to the in-repo packages/line-smith and packages/line-codemod (repo-relative),
// the env vars still override, and an in-repo source skips the commit pin check (it moves with the repo).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT, importLinked, isInRepo, linkStatus, readLinks, sourceDirOf } from '../index.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const SMITH = readLinks(path.join(HERE, '..', 'smith.json'));
const CODEMOD = readLinks(path.join(HERE, '..', 'atomic-codemod.json'));
const clean = { ...process.env };
delete clean.SMITH_SOURCE_DIR;
delete clean.ATOMIC_CODEMOD_SOURCE_DIR;
delete clean.LINE_LINKS_ALLOW_DRIFT;

test('the defaults are the in-repo packages, resolved from the repo root whatever the working folder', () => {
  assert.equal(sourceDirOf(SMITH, clean), path.join(REPO_ROOT, 'packages', 'line-smith'));
  assert.equal(sourceDirOf(CODEMOD, clean), path.join(REPO_ROOT, 'packages', 'line-codemod'));
  assert.ok(isInRepo(sourceDirOf(SMITH, clean)));
  assert.ok(!isInRepo(os.tmpdir()));
});

test('the env vars still override the default', () => {
  const dir = path.join(os.tmpdir(), 'elsewhere-smith');
  assert.equal(sourceDirOf(SMITH, { ...clean, SMITH_SOURCE_DIR: dir }), dir);
  assert.equal(sourceDirOf(CODEMOD, { ...clean, ATOMIC_CODEMOD_SOURCE_DIR: `~/${'x'}` }), path.join(os.homedir(), 'x'));
});

test('an in-repo source is ready with no commit pin check, even when the pin is stale', () => {
  const stale = { ...SMITH, source: { ...SMITH.source, commit: '0'.repeat(40) } };
  const st = linkStatus({ table: stale, env: clean });
  assert.equal(st.ok, true, st.message);
  assert.equal(st.drift, false);
  assert.match(st.message, /in this repo, no commit pin/);
  assert.match(st.packages[0].message, /^@smith\/core is linked from src\/index\.ts in this repo\.$/);
});

test('an outside source still has its pin checked', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'line-links-pin-'));
  fs.mkdirSync(path.join(dir, '.git'));
  fs.writeFileSync(path.join(dir, '.git', 'HEAD'), `${'1'.repeat(40)}\n`);
  try {
    const st = linkStatus({ table: SMITH, env: { ...clean, SMITH_SOURCE_DIR: dir } });
    assert.equal(st.ok, false);
    assert.equal(st.packages[0].state, 'wrong-commit');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('both in-repo links load: Chain, Organism and Comparable from line-smith, to-english from line-codemod', async () => {
  const smith = await importLinked('@smith/core', { table: SMITH, env: clean });
  assert.ok(smith.ok, 'reason' in smith ? smith.reason : '');
  for (const k of ['Chain', 'Organism', 'Comparable']) assert.equal(typeof smith.module[k], 'function', k);
  const codemod = await importLinked('@smith/to-english', { table: CODEMOD, env: clean });
  assert.ok(codemod.ok, 'reason' in codemod ? codemod.reason : '');
});
