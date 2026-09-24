import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { openNotesStore, notesDir, NotesStoreError, MAX_NOTE_BODY_BYTES } from './notesStore.mjs';
import { projectKey } from '../../../packages/engine/processStore.mjs';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';

function freshStateDir() {
  return makeTempDir('construct-notes-state-');
}

function freshProject() {
  return makeTempDir('construct-notes-project-');
}

test('notesDir: <stateDir>/notes/<projectKey(projectRoot)>', () => {
  const stateDir = freshStateDir();
  const project = freshProject();
  assert.equal(notesDir(project, { stateDir }), path.join(stateDir, 'notes', projectKey(project)));
});

test('create/get round trip: stamps id, rev 1, timestamps, defaults', () => {
  const store = openNotesStore(freshProject(), { stateDir: freshStateDir(), now: () => '2026-09-23T00:00:00.000Z' });
  const note = store.create({ title: 'Add a login screen', body: 'Users should be able to sign in with GitHub.' });
  assert.equal(typeof note.id, 'string');
  assert.ok(note.id.length > 0);
  assert.equal(note.rev, 1);
  assert.equal(note.status, 'draft');
  assert.equal(note.plan, null);
  assert.equal(note.processId, null);
  assert.equal(note.createdAt, '2026-09-23T00:00:00.000Z');
  assert.equal(note.updatedAt, '2026-09-23T00:00:00.000Z');

  const loaded = store.get(note.id);
  assert.deepEqual(loaded, note);
});

test('get: null for a note that does not exist', () => {
  const store = openNotesStore(freshProject(), { stateDir: freshStateDir() });
  assert.equal(store.get('nope'), null);
});

test('list: newest-updated first, only this project\'s notes', () => {
  const stateDir = freshStateDir();
  let clock = 0;
  const store = openNotesStore(freshProject(), { stateDir, now: () => `t${clock++}` });
  const a = store.create({ title: 'first' });
  const b = store.create({ title: 'second' });
  const { notes, problems } = store.list();
  assert.deepEqual(problems, []);
  assert.deepEqual(notes.map((n) => n.id), [b.id, a.id]);

  const other = openNotesStore(freshProject(), { stateDir });
  assert.deepEqual(other.list().notes, []);
});

test('list: a corrupt note file is reported as a problem, not thrown, and does not hide the rest', () => {
  const stateDir = freshStateDir();
  const project = freshProject();
  const store = openNotesStore(project, { stateDir });
  const ok = store.create({ title: 'fine' });
  fs.mkdirSync(notesDir(project, { stateDir }), { recursive: true });
  fs.writeFileSync(path.join(notesDir(project, { stateDir }), 'broken.json'), '{not json');

  const { notes, problems } = store.list();
  assert.deepEqual(notes.map((n) => n.id), [ok.id]);
  assert.equal(problems.length, 1);
  assert.equal(problems[0].id, 'broken');
});

test('update: full round trip changes fields, bumps rev, updates updatedAt, preserves plan shape', () => {
  let clock = 0;
  const store = openNotesStore(freshProject(), { stateDir: freshStateDir(), now: () => `t${clock++}` });
  const note = store.create({ title: 'Draft', body: 'first pass' });
  const plan = { steps: [{ id: 's1', kind: 'domain', summary: 'add User' }] };

  const updated = store.update(note.id, { rev: note.rev, body: 'second pass', plan, status: 'plan-ready' });
  assert.equal(updated.rev, 2);
  assert.equal(updated.body, 'second pass');
  assert.equal(updated.title, 'Draft'); // untouched field preserved
  assert.deepEqual(updated.plan, plan);
  assert.equal(updated.status, 'plan-ready');
  assert.notEqual(updated.updatedAt, note.createdAt);

  assert.deepEqual(store.get(note.id), updated);
});

test('update: rejects a stale rev with a distinguishable 409 STALE_REV error', () => {
  const store = openNotesStore(freshProject(), { stateDir: freshStateDir() });
  const note = store.create({ title: 'x' });
  store.update(note.id, { rev: note.rev, body: 'edited once' }); // now rev 2 on disk

  assert.throws(
    () => store.update(note.id, { rev: note.rev, body: 'edited from a stale copy' }), // caller still has rev 1
    (err) => {
      assert.ok(err instanceof NotesStoreError);
      assert.equal(err.status, 409);
      assert.equal(err.code, 'STALE_REV');
      return true;
    },
  );
  // The stale write must not have landed.
  assert.equal(store.get(note.id).body, 'edited once');
});

test('update: a missing rev is a distinct 400 REV_REQUIRED error, not treated as a stale write', () => {
  const store = openNotesStore(freshProject(), { stateDir: freshStateDir() });
  const note = store.create({ title: 'x' });
  assert.throws(
    () => store.update(note.id, { body: 'no rev sent' }),
    (err) => {
      assert.ok(err instanceof NotesStoreError);
      assert.equal(err.status, 400);
      assert.equal(err.code, 'REV_REQUIRED');
      return true;
    },
  );
});

test('update: no such note is a 404 NOT_FOUND error', () => {
  const store = openNotesStore(freshProject(), { stateDir: freshStateDir() });
  assert.throws(
    () => store.update('does-not-exist', { rev: 1, body: 'x' }),
    (err) => {
      assert.equal(err.status, 404);
      assert.equal(err.code, 'NOT_FOUND');
      return true;
    },
  );
});

test('create/update: oversize body is rejected with a distinct 413 TOO_LARGE error, and never written', () => {
  const store = openNotesStore(freshProject(), { stateDir: freshStateDir() });
  const tooBig = 'x'.repeat(MAX_NOTE_BODY_BYTES + 1);
  assert.throws(
    () => store.create({ title: 'huge', body: tooBig }),
    (err) => {
      assert.ok(err instanceof NotesStoreError);
      assert.equal(err.status, 413);
      assert.equal(err.code, 'TOO_LARGE');
      return true;
    },
  );
  assert.deepEqual(store.list().notes, []);

  const note = store.create({ title: 'ok', body: 'fits' });
  assert.throws(
    () => store.update(note.id, { rev: note.rev, body: tooBig }),
    (err) => {
      assert.equal(err.code, 'TOO_LARGE');
      return true;
    },
  );
  assert.equal(store.get(note.id).body, 'fits'); // unchanged
});

test('create: an unknown status is rejected with a 400 INVALID_STATUS error', () => {
  const store = openNotesStore(freshProject(), { stateDir: freshStateDir() });
  assert.throws(
    () => store.create({ title: 'x', status: 'not-a-real-status' }),
    (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.code, 'INVALID_STATUS');
      return true;
    },
  );
});

test('remove: true when a note existed, false otherwise; removed note is gone from get and list', () => {
  const store = openNotesStore(freshProject(), { stateDir: freshStateDir() });
  const note = store.create({ title: 'temp' });
  assert.equal(store.remove(note.id), true);
  assert.equal(store.get(note.id), null);
  assert.deepEqual(store.list().notes, []);
  assert.equal(store.remove(note.id), false);
  assert.equal(store.remove('never-existed'), false);
});

test('atomic write: no partial file is ever visible at the normal read path, even under repeated rapid saves', () => {
  const store = openNotesStore(freshProject(), { stateDir: freshStateDir() });
  const note = store.create({ title: 'x', body: 'v0' });
  let rev = note.rev;
  for (let i = 1; i <= 20; i++) {
    const updated = store.update(note.id, { rev, body: `v${i}`.repeat(500) });
    rev = updated.rev;
    // Every read in between must parse cleanly — a half-written temp file would show up as JSON.parse
    // failure here, since a fresh store instance reads the same file a concurrent writer would.
    const reread = openNotesStore(store.projectRoot, { stateDir: path.dirname(path.dirname(store.dir)) }).get(note.id);
    assert.equal(reread.body, `v${i}`.repeat(500));
  }
  // No stray .tmp-* files left behind after a clean run.
  const leftovers = fs.readdirSync(store.dir).filter((n) => n.includes('.tmp-'));
  assert.deepEqual(leftovers, []);
});

test('survives a fresh store instance pointed at the same dir (simulated server restart)', () => {
  const stateDir = freshStateDir();
  const project = freshProject();
  const before = openNotesStore(project, { stateDir });
  const plan = { steps: ['a', 'b'] };
  const note = before.create({ title: 'Persists across restart', body: 'body text', plan, status: 'plan-ready' });
  const updated = before.update(note.id, { rev: note.rev, body: 'edited before restart' });

  // A brand-new store instance, same project root and state dir, no shared in-memory state.
  const after = openNotesStore(project, { stateDir });
  const reloaded = after.get(note.id);
  assert.deepEqual(reloaded, updated);
  assert.deepEqual(reloaded.plan, plan); // plan shape preserved across the "restart"
  assert.deepEqual(after.list().notes.map((n) => n.id), [note.id]);
});

test('#596 plan freshness: editing the text after a plan marks it stale; saving a plan clears it; no plan, never stale', () => {
  const store = openNotesStore(freshProject(), { stateDir: freshStateDir() });
  const note = store.create({ title: 'x', body: 'one' });
  assert.equal(note.planStale, false);
  const noPlan = store.update(note.id, { rev: note.rev, body: 'two' });
  assert.equal(noPlan.planStale, false, 'a note with no plan has nothing to be out of date');

  const withPlan = store.update(note.id, { rev: noPlan.rev, plan: { steps: [] }, status: 'plan-ready' });
  assert.equal(withPlan.planStale, false);
  const same = store.update(note.id, { rev: withPlan.rev, body: 'two' });
  assert.equal(same.planStale, false, 'saving identical text does not stale the plan');
  const edited = store.update(note.id, { rev: same.rev, body: 'three' });
  assert.equal(edited.planStale, true);
  const stillStale = store.update(note.id, { rev: edited.rev, status: 'plan-ready' });
  assert.equal(stillStale.planStale, true, 'stays stale until a plan is saved again');
  const renewed = store.update(note.id, { rev: stillStale.rev, plan: { steps: [{ id: 'a' }] } });
  assert.equal(renewed.planStale, false);
});
