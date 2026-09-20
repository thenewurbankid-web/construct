// Pure logic of a clone's freshness (#306): the tag, the overview and the banner model. The verdict comes from core.
import test from 'node:test';
import assert from 'node:assert/strict';
import { cloneTag, staleOverview } from './Freshness.ts';
import { freshnessModel } from './FreshnessView.ts';
import { FAILURE_KINDS } from './FailureKinds.ts';

const clone = (state, stale) => ({ name: `${state}.spec.ts`, kind: 'clone', area: 'yours', freshness: { state, stale, summary: '', changes: 0 } });

test('the tag says out of date in words; only a stale clone gets it', () => {
  assert.equal(cloneTag(clone('scenario-changed', true)), 'out of date');
  assert.equal(cloneTag(clone('machine-changed', false)), 'clone');
  assert.equal(cloneTag({ kind: 'authored', area: 'yours' }), 'yours');
});

test('overview lists only the stale clones, with the right grammar; null when none', () => {
  assert.equal(staleOverview({ yours: [clone('current', false)] }), null);
  assert.equal(staleOverview(null), null);
  const one = staleOverview({ yours: [clone('scenario-changed', true), clone('current', false)] });
  assert.deepEqual(one.names, ['scenario-changed.spec.ts']);
  assert.match(one.summary, /^1 of your clone may be out of date: the flow it was cloned from has changed\.$/);
  assert.match(staleOverview({ yours: [clone('scenario-changed', true), clone('scenario-removed', true)] }).summary, /^2 of your clones/);
});

const ready = (data) => ({ status: 'ready', data: { ok: true, comparable: true, changes: [], from: null, next: null, summary: 's', ...data } });

test('banner model: stale with the diff, removed without Edit steps, machine-changed as a quiet note, current as nothing', () => {
  const changed = freshnessModel(ready({ state: 'scenario-changed', from: { scenario: 'Happy path' }, changes: [{ kind: 'added', text: 'A new step' }] }));
  assert.equal(changed.kind, 'stale');
  assert.equal(changed.title, 'Possibly out of date');
  assert.deepEqual(changed.changes.map((c) => c.word), ['New']);
  const gone = freshnessModel(ready({ state: 'scenario-removed' }));
  assert.equal(gone.caveat, null);
  assert.equal(freshnessModel(ready({ state: 'machine-changed' })).kind, 'note');
  assert.equal(freshnessModel(ready({ state: 'current' })).kind, 'none');
  assert.match(freshnessModel(ready({ state: 'scenario-changed', comparable: false })).caveat, /could not be compared/);
  assert.equal(freshnessModel({ status: 'loading' }).kind, 'loading');
});

test('the two failure kinds: only the app one is a bug', () => {
  assert.deepEqual(FAILURE_KINDS.map((k) => k.id), ['convention', 'app']);
  assert.match(FAILURE_KINDS[0].action, /Not a product bug/);
  assert.match(FAILURE_KINDS[1].action, /bug report/);
});
