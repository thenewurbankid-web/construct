// Commit-on-save (#283) against REAL git repositories in a temp dir — not a mocked git, because
// the whole risk of this feature is what it does to a real history: which files it stages, which
// branch it creates, and what it does with work that was already sitting in the tree.
//
// What each group proves:
//   * the three granularity modes behave differently and are all reachable;
//   * the coalescing window folds a burst into ONE commit;
//   * a commit stages only the files the Cockpit wrote — never `git add -A`;
//   * a dirty tree at session start asks, with the changed files grouped by feature and layer, and
//     the answer is honoured and (optionally) remembered;
//   * the session branch is created on the first save, named after the work, and never renamed;
//   * serials continue on a reopened session branch and never collide between sessions.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  answerDirtyPrompt, flushSession, getCommitConfig, getSessionStatus, recordSave,
  resetAutoCommit, setSessionPlan, updateCommitConfig, AutoCommitError, MAX_COALESCE_MS,
} from './autoCommit.mjs';
import * as git from './git.mjs';

const ROOTS = [];

function run(cwd, args) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
}

/** A real Construct-shaped project in a real git repo with one commit on `main`. */
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-autocommit-'));
  ROOTS.push(root);
  fs.writeFileSync(path.join(root, 'architecture.yml'), 'features:\n  root: features\n');
  const write = (rel, body) => {
    fs.mkdirSync(path.join(root, path.dirname(rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), body);
  };
  write('features/billing/domain/billingRules.ts', '// Pure billing rules.\nexport const vat = (n: number) => n * 0.2;\n');
  write('features/billing/pages/BillingPage.tsx', '// The billing page.\nexport default function BillingPage() { return null; }\n');
  write('features/checkout/domain/checkoutRules.ts', '// Pure checkout rules.\nexport const total = (n: number) => n;\n');
  run(root, ['init', '-q', '-b', 'main']);
  run(root, ['config', 'user.email', 'test@example.com']);
  run(root, ['config', 'user.name', 'Test']);
  run(root, ['add', '-A']);
  run(root, ['commit', '-qm', 'initial']);
  return root;
}

const edit = (root, rel, body) => fs.writeFileSync(path.join(root, rel), body);
const BILLING = 'features/billing/domain/billingRules.ts';
const PAGE = 'features/billing/pages/BillingPage.tsx';
const CHECKOUT = 'features/checkout/domain/checkoutRules.ts';

test.beforeEach(() => resetAutoCommit());
test.after(() => {
  resetAutoCommit();
  for (const r of ROOTS) fs.rmSync(r, { recursive: true, force: true });
});

// ---- the defaults ---------------------------------------------------------------------------------

test('auto-commit is on by default, in coalesce mode, with a 30s window', () => {
  const c = getCommitConfig();
  assert.equal(c.enabled, true);
  assert.equal(c.mode, 'coalesce');
  assert.equal(c.coalesceMs, 30_000);
  assert.deepEqual(c.modes, ['coalesce', 'every-save', 'manual']);
});

test('the off switch really is off — nothing is committed and no branch appears', () => {
  const root = makeRepo();
  updateCommitConfig({ enabled: false });
  edit(root, BILLING, '// changed\n');
  assert.deepEqual(recordSave(root, BILLING), { committed: false, status: 'disabled' });
  assert.equal(git.currentBranch(root), 'main');
  assert.equal(git.status(root).length, 1, 'the save is still there, just uncommitted');
});

test('a bad config value is refused rather than quietly ignored', () => {
  assert.throws(() => updateCommitConfig({ mode: 'whenever' }), AutoCommitError);
  assert.throws(() => updateCommitConfig({ coalesceMs: MAX_COALESCE_MS + 1 }), AutoCommitError);
  assert.throws(() => updateCommitConfig({ messagePrefix: 'oh no spaces' }), AutoCommitError);
  assert.equal(updateCommitConfig({ messagePrefix: '' }).messagePrefix, '', 'an empty prefix is a valid choice');
});

test('a directory that is not a git repo degrades instead of failing the save', () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'construct-nogit-'));
  ROOTS.push(plain);
  assert.deepEqual(recordSave(plain, 'a.ts'), { committed: false, status: 'not-a-repo' });
});

// ---- every-save ------------------------------------------------------------------------------------

test('every-save commits each save, on a session branch created by the first one', () => {
  const root = makeRepo();
  updateCommitConfig({ mode: 'every-save' });

  edit(root, BILLING, '// one\n');
  const first = recordSave(root, BILLING);
  assert.equal(first.committed, true, JSON.stringify(first));
  assert.match(first.commit.subject, /^CON-[0-9a-f]{4}-0001: billing: update billingRules$/);
  assert.match(first.commit.branch, /^cockpit\/billing-rules-[0-9a-f]{4}$/);
  assert.equal(git.currentBranch(root), first.commit.branch);

  edit(root, PAGE, '// two\n');
  const second = recordSave(root, PAGE);
  assert.equal(second.committed, true);
  assert.match(second.commit.subject, /^CON-[0-9a-f]{4}-0002: /, 'the serial advances within the branch');
  assert.equal(second.commit.branch, first.commit.branch, 'the branch name is fixed once created');
  assert.equal(git.status(root).length, 0, 'the tree is clean again');
});

test('the commit body carries the impact counts and the deterministic summary', () => {
  const root = makeRepo();
  updateCommitConfig({ mode: 'every-save' });
  edit(root, BILLING, '// one\n');
  const r = recordSave(root, BILLING);
  const body = run(root, ['log', '-1', '--format=%b']);
  assert.match(body, /^1 feature, 1 layer, 1 file$/m);
  assert.match(body, /^ {2}billing: domain$/m);
  assert.match(body, /^Construct-Serial: 1$/m);
  assert.match(body, /^Construct-Summary: deterministic .*no LLM$/m);
  assert.deepEqual(r.commit.impact.perFeature, [{ name: 'billing', layers: ['domain'] }]);
});

test('a commit stages only what the Cockpit wrote', () => {
  const root = makeRepo();
  updateCommitConfig({ mode: 'every-save' });
  // Answer the dirty-tree question first (the unrelated edit is what triggers it).
  edit(root, CHECKOUT, '// someone else was editing this\n');
  edit(root, BILLING, '// the cockpit wrote this\n');
  const asked = recordSave(root, BILLING);
  assert.equal(asked.status, 'needs-decision');
  assert.deepEqual(asked.dirty.files, [CHECKOUT]);

  // "Stash" is the answer that most clearly proves the scoping; "carry" is covered below.
  const done = answerDirtyPrompt(root, { answer: 'stash' });
  assert.equal(done.committed, true);
  const committed = run(root, ['show', '--name-only', '--format=', 'HEAD']).trim().split('\n');
  assert.deepEqual(committed, [BILLING]);
  assert.match(getSessionStatus(root).session.stash, /construct-cockpit/);
});

// ---- coalesce --------------------------------------------------------------------------------------

test('coalesce folds a burst of saves into one commit', async () => {
  const root = makeRepo();
  updateCommitConfig({ mode: 'coalesce', coalesceMs: 60 });

  edit(root, BILLING, '// a\n');
  const first = recordSave(root, BILLING);
  assert.equal(first.status, 'coalescing');
  assert.ok(first.dueInMs > 0 && first.dueInMs <= 60);

  edit(root, BILLING, '// a again\n');
  edit(root, PAGE, '// b\n');
  recordSave(root, BILLING);
  const third = recordSave(root, PAGE);
  assert.deepEqual(third.pending.sort(), [BILLING, PAGE].sort());

  await new Promise((r) => setTimeout(r, 140));
  assert.equal(run(root, ['rev-list', '--count', 'HEAD']).trim(), '2', 'one commit for the whole burst');
  const files = run(root, ['show', '--name-only', '--format=', 'HEAD']).trim().split('\n').sort();
  assert.deepEqual(files, [BILLING, PAGE].sort());
  assert.match(run(root, ['log', '-1', '--format=%s']), /^CON-[0-9a-f]{4}-0001: billing: update /);
});

test('a later save in the window does not push the window out', async () => {
  const root = makeRepo();
  updateCommitConfig({ mode: 'coalesce', coalesceMs: 80 });
  edit(root, BILLING, '// a\n');
  recordSave(root, BILLING);
  await new Promise((r) => setTimeout(r, 50));
  edit(root, PAGE, '// b\n');
  const later = recordSave(root, PAGE);
  assert.ok(later.dueInMs < 40, `the window must still be the original one, got ${later.dueInMs}ms`);
  await new Promise((r) => setTimeout(r, 90));
  assert.equal(run(root, ['rev-list', '--count', 'HEAD']).trim(), '2');
});

test('flush commits without waiting for the window', () => {
  const root = makeRepo();
  updateCommitConfig({ mode: 'coalesce', coalesceMs: MAX_COALESCE_MS });
  edit(root, BILLING, '// a\n');
  recordSave(root, BILLING);
  const flushed = flushSession(root);
  assert.equal(flushed.committed, true);
  assert.equal(getSessionStatus(root).session.pending.length, 0);
  assert.equal(flushSession(root).status, 'nothing-pending');
});

// ---- manual -----------------------------------------------------------------------------------------

test('manual holds saves until the user commits, keeping the same message format', () => {
  const root = makeRepo();
  updateCommitConfig({ mode: 'manual' });
  edit(root, BILLING, '// a\n');
  const r = recordSave(root, BILLING);
  assert.equal(r.status, 'manual');
  assert.equal(run(root, ['rev-list', '--count', 'HEAD']).trim(), '1', 'nothing committed yet');
  assert.equal(git.currentBranch(root), 'main', 'no branch until there is a commit to put on it');

  const committed = flushSession(root);
  assert.equal(committed.committed, true);
  assert.match(committed.commit.subject, /^CON-[0-9a-f]{4}-0001: billing: update billingRules$/);
});

// ---- the dirty-tree prompt ------------------------------------------------------------------------------

test('a dirty tree asks a question worth reading — files grouped by feature and layer', () => {
  const root = makeRepo();
  updateCommitConfig({ mode: 'every-save' });
  edit(root, CHECKOUT, '// pre-existing\n');
  edit(root, PAGE, '// pre-existing too\n');
  edit(root, BILLING, '// the save\n');

  const asked = recordSave(root, BILLING);
  assert.equal(asked.status, 'needs-decision');
  assert.deepEqual(asked.dirty.files.sort(), [CHECKOUT, PAGE].sort());
  const names = asked.dirty.groups.map((g) => g.name).sort();
  assert.deepEqual(names, ['billing', 'checkout']);
  assert.deepEqual(asked.dirty.groups.find((g) => g.name === 'billing').layers, ['page']);
  assert.match(asked.dirty.question, /carry onto this session's branch, or stash\?$/);
  assert.match(asked.dirty.question, /file\(s\) in (billing|checkout) \((page|domain)\)/);
});

test('carrying commits the pre-existing work but never counts it', () => {
  const root = makeRepo();
  updateCommitConfig({ mode: 'every-save' });
  edit(root, CHECKOUT, '// pre-existing\n');
  edit(root, BILLING, '// the save\n');
  recordSave(root, BILLING);

  const done = answerDirtyPrompt(root, { answer: 'carry' });
  assert.equal(done.committed, true);
  const files = run(root, ['show', '--name-only', '--format=', 'HEAD']).trim().split('\n').sort();
  assert.deepEqual(files, [BILLING, CHECKOUT].sort(), 'the carried file is committed');
  assert.deepEqual(done.commit.impact, { features: 1, layers: 1, files: 1, perFeature: [{ name: 'billing', layers: ['domain'] }] });
  const body = run(root, ['log', '-1', '--format=%b']);
  assert.match(body, /^Carried in from before this session \(committed, not counted above\): 1 file\(s\)$/m);
  assert.match(body, /^1 feature, 1 layer, 1 file$/m);
});

test('stashing says plainly where the work went', () => {
  const root = makeRepo();
  updateCommitConfig({ mode: 'every-save' });
  edit(root, CHECKOUT, '// pre-existing\n');
  edit(root, BILLING, '// the save\n');
  recordSave(root, BILLING);
  answerDirtyPrompt(root, { answer: 'stash' });

  const stash = getSessionStatus(root).session.stash;
  assert.match(stash, /^stash@\{0\}/);
  assert.match(run(root, ['stash', 'list']), /construct-cockpit/);
  assert.equal(fs.readFileSync(path.join(root, CHECKOUT), 'utf8'), '// Pure checkout rules.\nexport const total = (n: number) => n;\n', 'the stashed file is back to its committed state');
});

test('the answer can be remembered per project, so it is not asked forever', () => {
  const root = makeRepo();
  updateCommitConfig({ mode: 'every-save' });
  edit(root, CHECKOUT, '// pre-existing\n');
  edit(root, BILLING, '// the save\n');
  recordSave(root, BILLING);
  answerDirtyPrompt(root, { answer: 'carry', remember: true });
  assert.equal(getSessionStatus(root).remembered, 'carry');

  // A second project directory is a second session — but this one is remembered, so a later
  // session on the same project skips the question.
  const status = getSessionStatus(root);
  assert.equal(status.session.dirtyAnswer, 'carry');
});

test('a clean tree is never asked at all', () => {
  const root = makeRepo();
  updateCommitConfig({ mode: 'every-save' });
  edit(root, BILLING, '// the save\n');
  const r = recordSave(root, BILLING);
  assert.equal(r.committed, true, 'no prompt on a clean tree');
});

test('an unknown dirty-tree answer is refused', () => {
  const root = makeRepo();
  updateCommitConfig({ mode: 'every-save' });
  edit(root, CHECKOUT, '// pre-existing\n');
  edit(root, BILLING, '// the save\n');
  recordSave(root, BILLING);
  assert.throws(() => answerDirtyPrompt(root, { answer: 'delete-it-all' }), AutoCommitError);
});

// ---- the session branch ---------------------------------------------------------------------------------

test('the branch is named after the plan when the session has one', () => {
  const root = makeRepo();
  updateCommitConfig({ mode: 'every-save' });
  setSessionPlan(root, { planTitle: 'Rewire the checkout flow' });
  edit(root, BILLING, '// a\n');
  const r = recordSave(root, BILLING);
  assert.match(r.commit.branch, /^cockpit\/rewire-the-checkout-flow-[0-9a-f]{4}$/);
});

test('the plan splits the commit body into planned and unplanned files', () => {
  const root = makeRepo();
  updateCommitConfig({ mode: 'every-save' });
  setSessionPlan(root, { plan: { steps: [{ id: 's1', touches: { features: ['billing'], files: [{ path: BILLING }] } }] } });
  edit(root, BILLING, '// a\n');
  edit(root, PAGE, '// b\n');
  recordSave(root, [BILLING, PAGE]);
  assert.match(run(root, ['log', '-1', '--format=%b']), /^Plan: 1 of 2 changed file\(s\) are in the plan; 1 unplanned/m);
});

test('the user owns the branch prefix and suffix', () => {
  const root = makeRepo();
  updateCommitConfig({ mode: 'every-save', branchPrefix: '', branchSuffix: '-wip', messagePrefix: 'PROJ-9' });
  edit(root, BILLING, '// a\n');
  const r = recordSave(root, BILLING);
  assert.match(r.commit.branch, /^billing-rules-[0-9a-f]{4}-wip$/, 'no prefix means no directory component');
  assert.match(r.commit.subject, /^PROJ-9-[0-9a-f]{4}-0001: /);
});

test('reopening a session branch continues its serial instead of restarting', () => {
  const root = makeRepo();
  updateCommitConfig({ mode: 'every-save' });
  edit(root, BILLING, '// a\n');
  const first = recordSave(root, BILLING);
  edit(root, PAGE, '// b\n');
  recordSave(root, PAGE);

  // A new Cockpit session (server restart, reopened project) on the same checked-out branch.
  resetAutoCommit();
  updateCommitConfig({ mode: 'every-save' });
  edit(root, CHECKOUT, '// c\n');
  const resumed = recordSave(root, CHECKOUT);
  assert.equal(resumed.commit.branch, first.commit.branch, 'no second branch');
  assert.match(resumed.commit.subject, /-0003: /, 'the serial continues from the branch history');
  assert.equal(resumed.commit.sessionId, first.commit.sessionId, 'the session id is adopted from the branch');
});

test('no auto-push — the commit is local and nothing contacts a remote', () => {
  const root = makeRepo();
  run(root, ['remote', 'add', 'origin', 'https://example.invalid/nope.git']);
  updateCommitConfig({ mode: 'every-save' });
  edit(root, BILLING, '// a\n');
  const r = recordSave(root, BILLING);
  assert.equal(r.committed, true);
  // An upstream would only exist if something had pushed. Nothing did.
  assert.equal(git.git(root, ['rev-parse', '--abbrev-ref', '@{upstream}'], { allowFail: true }).ok, false);
});

// ---- status ---------------------------------------------------------------------------------------------

test('the status is enough to render the indicator without a second call', () => {
  const root = makeRepo();
  updateCommitConfig({ mode: 'every-save' });
  edit(root, BILLING, '// a\n');
  recordSave(root, BILLING);
  const s = getSessionStatus(root);
  assert.equal(s.repo, true);
  assert.equal(s.config.mode, 'every-save');
  assert.equal(s.session.branch, s.branch);
  assert.match(s.session.lastCommit.label, /^CON-[0-9a-f]{4}-0001$/);
  assert.equal(s.session.lastCommit.impact.features, 1);
  assert.deepEqual(s.session.pending, []);
});
