import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildStoryIndicatorState } from './StoryIndicatorState.ts';

const tool = (over = {}) => ({
  fetchedAt: '2026-10-01T00:00:00Z', sourceHash: 'h', blockHash: 'b', handEdited: false,
  title: 'T', description: '', status: '', acceptance: [{ id: 'S1', text: 'a' }, { id: 'S2', text: 'b' }], ...over,
});
const view = (over = {}) => ({
  ok: true, exists: true, keptOutOfGit: false, sources: [], tool: tool(), userText: '',
  compare: { missing: [], undocumented: [], matched: ['S1', 'S2'] }, driftHash: 'd', reviewedHash: 'd', ...over,
});

test('not ok -> null (unknown, render nothing)', () => {
  assert.equal(buildStoryIndicatorState({ ok: false, error: 'x' }), null);
});

test('no file -> no-story', () => {
  assert.deepEqual(buildStoryIndicatorState({ ok: true, exists: false }), { kind: 'no-story' });
});

test('no tool block (direct content) -> null, not a guessed 0/0', () => {
  assert.equal(buildStoryIndicatorState(view({ tool: null })), null);
});

test('hand-edited tool block -> edited-by-hand, regardless of drift', () => {
  assert.deepEqual(buildStoryIndicatorState(view({ tool: tool({ handEdited: true }) })), { kind: 'edited-by-hand' });
});

test('drift hash differs from reviewed hash -> stale-vs-code', () => {
  assert.deepEqual(buildStoryIndicatorState(view({ driftHash: 'd2', reviewedHash: 'd1' })), { kind: 'stale-vs-code' });
});

test('reviewedHash null (never reviewed) with a non-empty drift -> stale-vs-code', () => {
  assert.deepEqual(buildStoryIndicatorState(view({ driftHash: 'd2', reviewedHash: null })), { kind: 'stale-vs-code' });
});

test('fresh tool block, drift matches reviewed -> in-sync with counts and the one wired via', () => {
  assert.deepEqual(
    buildStoryIndicatorState(view()),
    { kind: 'in-sync', matched: 2, total: 2, via: 'server' },
  );
});

test('in-sync counts partial matches', () => {
  assert.deepEqual(
    buildStoryIndicatorState(view({ compare: { missing: ['S2'], undocumented: [], matched: ['S1'] } })),
    { kind: 'in-sync', matched: 1, total: 2, via: 'server' },
  );
});
