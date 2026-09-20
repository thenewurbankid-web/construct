import test from 'node:test';
import assert from 'node:assert/strict';
import { MODE_LABELS, describeMode, formatWindow } from './CommitWording.ts';
import { describeImpact, describePerFeature } from './CommitImpactText.ts';
import { canCommitNow, describeDirtyGroups, describeSaveState } from './SaveState.ts';
import { buildAutoCommitView, buildGitSessionView } from './GitSessionView.ts';

const commit = {
  sha: 'abc123', label: 'CON-a3f7-0007', subject: 'CON-a3f7-0007: billing: update billingRules',
  serial: 7, branch: 'cockpit/billing-rules-a3f7', sessionId: 'a3f7', files: ['features/billing/domain/billingRules.ts'],
  impact: { features: 2, layers: 5, files: 3, perFeature: [{ name: 'checkout', layers: ['page', 'controller'] }, { name: 'billing', layers: ['domain'] }] },
  message: 'x', at: '2026-09-20T10:00:00.000Z',
};

const prompt = {
  count: 3,
  files: ['features/billing/domain/b.ts', 'features/billing/services/s.ts', 'features/checkout/pages/CheckoutPage.tsx'],
  groups: [
    { name: 'billing', kind: 'feature', layers: ['domain', 'service'], files: ['features/billing/domain/b.ts', 'features/billing/services/s.ts'] },
    { name: 'checkout', kind: 'feature', layers: ['page'], files: ['features/checkout/pages/CheckoutPage.tsx'] },
  ],
  question: "2 file(s) in billing (domain, service), 1 file(s) in checkout (page) — carry onto this session's branch, or stash?",
};

const config = {
  enabled: true, mode: 'coalesce', coalesceMs: 30_000, messagePrefix: 'CON', branchPrefix: 'cockpit',
  branchSuffix: '', modes: ['coalesce', 'every-save', 'manual'], maxCoalesceMs: 600_000,
};
const status = ({ config: configOver, ...over } = {}) => ({ ok: true, repo: true, branch: 'main', remembered: null, session: null, ...over, config: { ...config, ...(configOver || {}) } });
const session = (over = {}) => ({ sessionId: 'a3f7', branch: null, adopted: false, pending: [], dueInMs: null, awaitingDecision: null, dirtyAnswer: null, stash: null, commits: [], lastCommit: null, ...over });

test('a window reads as a duration, not milliseconds', () => {
  assert.equal(formatWindow(30_000), '30s');
  assert.equal(formatWindow(120_000), '2m');
  assert.equal(formatWindow(150_000), '2m 30s');
  assert.equal(formatWindow(0), 'immediately');
});

test('every mode explains what it will actually do', () => {
  assert.deepEqual(Object.keys(MODE_LABELS), ['coalesce', 'every-save', 'manual']);
  assert.match(describeMode('coalesce', 30_000), /within 30s of each other become one commit/);
  assert.match(describeMode('every-save', 30_000), /a lot of commits/);
  assert.match(describeMode('manual', 30_000), /until you click Commit/);
});

test('impact is stated in counted units, pluralised', () => {
  assert.equal(describeImpact(commit.impact), '2 features, 5 layers, 3 files');
  assert.equal(describeImpact({ features: 1, layers: 1, files: 1, perFeature: [] }), '1 feature, 1 layer, 1 file');
  assert.equal(describeImpact(null), '');
  assert.equal(describePerFeature(commit.impact), 'checkout: page, controller · billing: domain');
});

test('the indicator says what will happen, not only what did', () => {
  assert.deepEqual(describeSaveState(null), { kind: 'idle', text: 'Checking git…' });
  assert.match(describeSaveState(status()).text, /the next save commits to a new session branch/);

  const off = describeSaveState(status({ config: { enabled: false } }));
  assert.equal(off.kind, 'off');
  assert.match(off.text, /saves stay uncommitted/);

  const noRepo = describeSaveState(status({ repo: false }));
  assert.equal(noRepo.kind, 'no-repo');
  assert.match(noRepo.text, /written but not committed/);
});

test('a pending save says when it will land, per mode', () => {
  const coalescing = describeSaveState(status({ session: session({ pending: ['a.ts'], dueInMs: 12_000 }) }));
  assert.equal(coalescing.kind, 'pending');
  assert.match(coalescing.text, /1 unsaved-to-git change — committing in 12s\./);

  const manual = describeSaveState(status({ config: { mode: 'manual' }, session: session({ pending: ['a.ts', 'b.ts'] }) }));
  assert.match(manual.text, /2 unsaved-to-git changes — waiting for Commit\./);
});

test('a finished commit is identified by its label, branch and counted impact', () => {
  const done = describeSaveState(status({ session: session({ commits: [commit], lastCommit: commit }) }));
  assert.equal(done.kind, 'committed');
  assert.equal(done.text, 'CON-a3f7-0007 committed to cockpit/billing-rules-a3f7 — 2 features, 5 layers, 3 files.');
});

test('the dirty-tree question outranks everything else on the indicator', () => {
  const asking = describeSaveState(status({ session: session({ pending: ['x.ts'], dueInMs: 5_000, awaitingDecision: prompt }) }));
  assert.equal(asking.kind, 'asking');
  assert.match(asking.text, /3 file\(s\) were already changed when this session started\./);
  assert.deepEqual(describeDirtyGroups(prompt), ['billing (domain, service) — 2 files', 'checkout (page) — 1 file']);
  assert.deepEqual(describeDirtyGroups(null), []);
});

test('Commit is offered only when something is actually pending and answerable', () => {
  assert.equal(canCommitNow(null), false);
  assert.equal(canCommitNow(status()), false);
  assert.equal(canCommitNow(status({ session: session({ pending: ['a.ts'] }) })), true);
  assert.equal(canCommitNow(status({ session: session({ pending: ['a.ts'], awaitingDecision: prompt }) })), false);
  assert.equal(canCommitNow(status({ repo: false, session: session({ pending: ['a.ts'] }) })), false);
});

test('the save-time view model is fully formatted — components get strings, never payloads', () => {
  const view = buildGitSessionView(status({ session: session({ commits: [commit], lastCommit: commit, stash: 'stash@{0} On main: construct-cockpit a3f7' }) }));
  assert.equal(view.state.kind, 'committed');
  assert.equal(view.canCommit, false);
  assert.deepEqual(view.lastCommit, {
    label: 'CON-a3f7-0007',
    subject: 'CON-a3f7-0007: billing: update billingRules',
    branch: 'cockpit/billing-rules-a3f7',
    impactText: '2 features, 5 layers, 3 files',
    perFeatureText: 'checkout: page, controller · billing: domain',
  });
  assert.match(view.stash, /^stash@\{0\}/);
  assert.equal(view.prompt, null);

  const asking = buildGitSessionView(status({ session: session({ pending: ['x.ts'], awaitingDecision: prompt }) }));
  assert.equal(asking.prompt.count, 3);
  assert.deepEqual(asking.prompt.groupLines, ['billing (domain, service) — 2 files', 'checkout (page) — 1 file']);

  assert.equal(buildGitSessionView(null).state.text, 'Checking git…');
});

test('the settings view shows what the user\'s own prefixes will produce', () => {
  const view = buildAutoCommitView(status());
  assert.equal(view.messageExample, 'CON-a3f7-0007: …');
  assert.equal(view.branchExample, 'cockpit/billing-invoice-a3f7');
  assert.deepEqual(view.modeOptions.map((o) => o.value), ['coalesce', 'every-save', 'manual']);
  assert.deepEqual(view.windowOptions.map((o) => o.label), ['5s', '15s', '30s', '1m', '5m']);

  const bare = buildAutoCommitView(status({ config: { messagePrefix: '', branchPrefix: '', branchSuffix: '-wip' } }));
  assert.equal(bare.messageExample, 'a3f7-0007: …', 'an empty prefix drops the dash, it does not print "-"');
  assert.equal(bare.branchExample, 'billing-invoice-a3f7-wip');
});
