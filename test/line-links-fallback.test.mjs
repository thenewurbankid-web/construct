// cu1 -- when a linked Line module is down, Construct falls back to its static path and says so in one plain-English
// sentence: source folder missing, a folder that is not a git checkout, the source at another commit than links.json
// pins, and @mx/reason unavailable for the decision provider. Construct's own CLI is unaffected.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { importLinked, linkStatus, readLinks, readHeadCommit } from '../packages/line-links/index.mjs';
import { createReasonProvider } from '../packages/core/reason-provider.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MISSING = path.join(os.tmpdir(), 'cu1-no-such-source-folder');
const missingEnv = { ...process.env, LINE_SOURCE_DIR: MISSING };
const ONE_SENTENCE = /^[A-Z@][^\n]*\.$/;

test('source folder missing: every link is off, with one plain-English sentence each', () => {
  const s = linkStatus({ env: missingEnv });
  assert.equal(s.ok, false);
  assert.match(s.message, ONE_SENTENCE);
  assert.match(s.message, /source folder .* is missing .*static path/);
  for (const p of s.packages) {
    assert.equal(p.state, 'missing-source');
    assert.match(p.message, ONE_SENTENCE);
  }
});

test('source folder missing: importLinked answers ok:false with the reason and never throws', async () => {
  for (const name of Object.keys(readLinks().links)) {
    const r = await importLinked(name, { env: missingEnv });
    assert.equal(r.ok, false);
    assert.match(r.reason, new RegExp(`^${name.replace('/', '\\/')} is not linked because .*static path\\.$`));
  }
  const unknown = await importLinked('@mx/nope', { env: missingEnv });
  assert.match(unknown.reason, /not in packages\/line-links\/links.json/);
});

test('a folder that is not a git checkout is reported as such', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cu1-plain-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(readHeadCommit(dir), null);
  const s = linkStatus({ env: { LINE_SOURCE_DIR: dir } });
  assert.deepEqual([...new Set(s.packages.map((p) => p.state))], ['not-a-repo']);
  assert.match(s.message, /is not a git checkout/);
});

test('the source at another commit than links.json pins is not loaded unless drift is allowed', async (t) => {
  const real = linkStatus();
  if (!real.head) return t.skip(real.message);
  const table = { ...readLinks(), source: { ...readLinks().source, commit: '0'.repeat(40) } };
  const s = linkStatus({ table, env: { ...process.env, LINE_LINKS_ALLOW_DRIFT: '' } });
  assert.equal(s.ok, false);
  assert.equal(s.drift, true);
  assert.match(s.message, /pins 0000000 .*--pin/);
  const r = await importLinked('@mx/gatelm', { table, env: { ...process.env, LINE_LINKS_ALLOW_DRIFT: '' } });
  assert.equal(r.ok, false);
  const allowed = linkStatus({ table, env: { ...process.env, LINE_LINKS_ALLOW_DRIFT: '1' } });
  assert.equal(allowed.ok, true);
  assert.match(allowed.packages[0].message, /not the pinned commit/);
});

test('a git worktree checkout: HEAD is read from its git files (gitdir pointer, commondir, packed refs)', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cu1-git-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sha = 'a'.repeat(40);
  const main = path.join(dir, 'main-git');
  const wt = path.join(main, 'worktrees', 'w');
  fs.mkdirSync(wt, { recursive: true });
  fs.mkdirSync(path.join(dir, 'w'));
  fs.writeFileSync(path.join(dir, 'w', '.git'), `gitdir: ${wt}\n`);
  fs.writeFileSync(path.join(wt, 'HEAD'), 'ref: refs/heads/core/ship\n');
  fs.writeFileSync(path.join(wt, 'commondir'), '../..\n');
  fs.writeFileSync(path.join(main, 'packed-refs'), `# pack-refs\n${sha} refs/heads/core/ship\n`);
  assert.equal(readHeadCommit(path.join(dir, 'w')), sha);
});

test('reason provider with the source missing: the static path answers and says why', async () => {
  const saved = process.env.LINE_SOURCE_DIR;
  process.env.LINE_SOURCE_DIR = MISSING;
  try {
    const p = createReasonProvider();
    const s = await p.suggest({ id: 'q', question: 'Next?', options: [{ id: 'a', enabled: true }, { id: 'b', enabled: true }], chosen: null });
    assert.deepEqual(s, { option: 'a', reason: 'First available step; the reason module is not linked, so Line used the static order.', runnerUp: 'b' });
    assert.match(p.lastNote(), /@mx\/reason is not linked because the source folder .* is missing/);
  } finally {
    if (saved === undefined) delete process.env.LINE_SOURCE_DIR; else process.env.LINE_SOURCE_DIR = saved;
  }
});

test('the link step with the source missing exits 1 with plain sentences; construct validate is unaffected', () => {
  const link = spawnSync(process.execPath, [path.join(ROOT, 'packages/line-links/link.mjs')], { env: missingEnv, encoding: 'utf8' });
  assert.equal(link.status, 1);
  assert.match(link.stdout.split('\n')[0], /^Line links are off because .*; Construct runs on its static path\.$/);
  const fixture = path.join(ROOT, 'fixtures/architecture-valid');
  const run = (env) => spawnSync(process.execPath, [path.join(ROOT, 'packages/cli/construct.mjs'), 'validate', '--format', 'json', '--dir', fixture], { env, encoding: 'utf8' });
  const without = run(missingEnv);
  const withSource = run(process.env);
  assert.equal(without.status, withSource.status);
  assert.equal(without.stdout, withSource.stdout);
  assert.doesNotMatch(without.stderr, /line-links|LINE_SOURCE_DIR/);
});
