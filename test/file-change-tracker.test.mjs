import test from 'node:test';
import assert from 'node:assert/strict';
import { createChangeTracker } from '../packages/core/file-change-tracker.mjs';
import { buildDiffView } from '../packages/core/text-diff.mjs';

test('first observation is a baseline, not a change', () => {
  const t = createChangeTracker();
  assert.equal(t.observe('a', 'x'), null);
  assert.equal(t.getLastChange('a'), null);
});

test('different content is recorded as an external change with before/after', () => {
  let clock = 100;
  const t = createChangeTracker({ now: () => clock++ });
  t.observe('a', 'one\n');
  assert.equal(t.observe('a', 'one\n'), null);
  const c = t.observe('a', 'two\n');
  assert.equal(c.before, 'one\n');
  assert.equal(c.after, 'two\n');
  assert.notEqual(c.beforeHash, c.afterHash);
  assert.equal(t.getLastChange('a').at, 100);
  assert.equal(t.observe('a', 'two\n'), null);
  assert.equal(t.getLastChange('a').after, 'two\n');
});

test('adopt sets the baseline silently and clears the notice; files are independent', () => {
  const t = createChangeTracker();
  t.observe('a', '1'); t.observe('b', '1');
  t.observe('a', '2'); t.observe('b', '2');
  t.adopt('a', '3');
  assert.equal(t.getLastChange('a'), null);
  assert.equal(t.observe('a', '3'), null);
  assert.ok(t.getLastChange('b'));
  t.dismiss('b');
  assert.equal(t.getLastChange('b'), null);
});

test('buildDiffView numbers rows, counts stats and collapses distant context', () => {
  const before = Array.from({ length: 20 }, (_, i) => `l${i + 1}`).join('\n') + '\n';
  const after = before.replace('l10\n', 'L10\nextra\n');
  const { rows, stats } = buildDiffView(before, after, { context: 2 });
  assert.deepEqual(stats, { added: 2, removed: 1 });
  assert.equal(rows[0].kind, 'gap');
  assert.equal(rows[0].hidden, 7);
  const removed = rows.find((r) => r.kind === 'removed');
  assert.equal(removed.text, 'l10');
  assert.equal(removed.oldLine, 10);
  const added = rows.filter((r) => r.kind === 'added');
  assert.deepEqual(added.map((r) => [r.newLine, r.text]), [[10, 'L10'], [11, 'extra']]);
  assert.equal(rows.at(-1).kind, 'gap');
});

test('buildDiffView of identical text is a single collapsed gap with zero stats', () => {
  assert.deepEqual(buildDiffView('a\nb\n', 'a\nb\n'), { rows: [{ kind: 'gap', text: '2 unchanged lines', hidden: 2 }], stats: { added: 0, removed: 0 } });
});
