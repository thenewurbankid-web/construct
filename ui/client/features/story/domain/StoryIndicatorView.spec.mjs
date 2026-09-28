import test from 'node:test';
import assert from 'node:assert/strict';
import { buildStoryIndicatorView } from './StoryIndicatorView.ts';

// Every row of docs/design/mocks/ia-story-indicators.html, checked verbatim: text, tone (dot) and via label.
test('in sync: "3/5 matched", ok, via the serving strategy', () => {
  const v = buildStoryIndicatorView({ kind: 'in-sync', matched: 3, total: 5, via: 'your browser' });
  assert.equal(v.text, '3/5 matched');
  assert.equal(v.tone, 'ok');
  assert.equal(v.via, 'your browser');
  assert.deepEqual(v.actions, []);
});

test('ticket changed upstream: snapshot updated, offers view diff', () => {
  const v = buildStoryIndicatorView({ kind: 'ticket-changed', via: 'server' });
  assert.equal(v.text, 'ticket changed, snapshot updated');
  assert.equal(v.tone, 'warn');
  assert.equal(v.via, 'server');
  assert.deepEqual(v.actions, [{ id: 'view-diff', label: 'view diff' }]);
});

test('story stale vs code: may be out of date, offers mark reviewed, no via', () => {
  const v = buildStoryIndicatorView({ kind: 'stale-vs-code' });
  assert.equal(v.text, 'may be out of date');
  assert.equal(v.tone, 'warn');
  assert.equal(v.via, null);
  assert.deepEqual(v.actions, [{ id: 'mark-reviewed', label: 'mark reviewed' }]);
});

test('checking: single in-flight check, busy tone', () => {
  const v = buildStoryIndicatorView({ kind: 'checking', via: 'your browser' });
  assert.equal(v.text, 'checking ticket');
  assert.equal(v.tone, 'busy');
  assert.equal(v.via, 'your browser');
});

test('offline or clipper off: falls back to the snapshot, offers Install clipper', () => {
  const v = buildStoryIndicatorView({ kind: 'using-snapshot', at: '12:02', reason: 'offline-or-clipper-off' });
  assert.equal(v.text, 'using snapshot from 12:02');
  assert.equal(v.tone, 'off');
  assert.deepEqual(v.actions, [{ id: 'install-clipper', label: 'Install clipper' }]);
});

test('AI unavailable: same snapshot text, no action (nothing invented)', () => {
  const v = buildStoryIndicatorView({ kind: 'using-snapshot', at: '12:02', reason: 'ai-unavailable' });
  assert.equal(v.text, 'using snapshot from 12:02');
  assert.equal(v.tone, 'off');
  assert.deepEqual(v.actions, []);
});

test('host not approved: approve host, names the host', () => {
  const v = buildStoryIndicatorView({ kind: 'approve-host', host: 'acme.atlassian.net' });
  assert.equal(v.text, 'approve host');
  assert.equal(v.tone, 'warn');
  assert.match(v.title, /acme\.atlassian\.net/);
});

test('template did not match: re-pick, bad tone', () => {
  const v = buildStoryIndicatorView({ kind: 're-pick' });
  assert.equal(v.text, 're-pick');
  assert.equal(v.tone, 'bad');
});

test('snapshot edited by hand: refresh paused, keep mine / use the ticket', () => {
  const v = buildStoryIndicatorView({ kind: 'edited-by-hand' });
  assert.equal(v.text, 'snapshot edited, refresh paused');
  assert.equal(v.tone, 'warn');
  assert.deepEqual(v.actions, [{ id: 'keep-mine', label: 'keep mine' }, { id: 'use-the-ticket', label: 'use the ticket' }]);
});

test('no story yet: no text, only the Add a story action', () => {
  const v = buildStoryIndicatorView({ kind: 'no-story' });
  assert.equal(v.text, null);
  assert.equal(v.tone, 'none');
  assert.deepEqual(v.actions, [{ id: 'add-story', label: 'Add a story' }]);
});

test('direct content: story vs code only, via "written here"', () => {
  const v = buildStoryIndicatorView({ kind: 'direct-content', matched: 3, total: 5 });
  assert.equal(v.text, 'story vs code: 3/5');
  assert.equal(v.tone, 'ok');
  assert.equal(v.via, 'written here');
});

test('login-only, no pattern yet: pick fields, offers both entry points', () => {
  const v = buildStoryIndicatorView({ kind: 'login-only-no-pattern' });
  assert.equal(v.text, 'pick fields');
  assert.equal(v.tone, 'warn');
  assert.deepEqual(v.actions, [{ id: 'pick-fields', label: 'Pick fields' }, { id: 'ai-propose-pattern', label: 'AI proposes a pattern' }]);
});
