import test from 'node:test';
import assert from 'node:assert/strict';
import { AUTOSAVE_MS, isDirty, isReadOnly, pickInitial, rowOf } from './NoteDraft.ts';
import { compareLines } from './NoteCompare.ts';
import { clock, failureReason, indicatorOf, statusTag } from './NoteText.ts';
import { buildEditorView, buildRows } from './NotesView.ts';
import { initialScreen, screenReducer } from '../workflows/NotesMachine.ts';

const note = (extra = {}) => ({ id: 'n1', title: 'T', body: 'one', plan: null, status: 'draft', rev: 1, createdAt: '2026-09-24T10:00:00.000Z', updatedAt: '2026-09-24T10:00:00.000Z', processId: null, planStale: false, ...extra });
const run = (actions, from = initialScreen) => actions.reduce(screenReducer, from);
const opened = (n = note()) => run([{ type: 'LIST_LOADED', rows: [rowOf(n)] }, { type: 'OPENED', note: n }]);

test('autosave waits 800 ms; dirty means the page holds text the server copy does not', () => {
  assert.equal(AUTOSAVE_MS, 800);
  assert.equal(isDirty(note(), { title: 'T', body: 'one' }), false);
  assert.equal(isDirty(note(), { title: 'T', body: 'one!' }), true);
  assert.equal(isDirty(null, { title: 'x', body: 'y' }), false);
  assert.equal(isReadOnly(note({ status: 'ran' })), true);
  assert.equal(isReadOnly(note({ status: 'plan-ready' })), false);
});

test('opening a note shows it as saved; typing makes it honest again', () => {
  const s = opened();
  assert.equal(s.save.status, 'saved');
  const typed = screenReducer(s, { type: 'EDIT', edit: { body: 'two' } });
  assert.equal(typed.save.status, 'idle');
  assert.equal(typed.draft.body, 'two');
  assert.equal(typed.note.body, 'one', 'the confirmed copy only moves when the server confirms');
});

test('a save keeps text typed while it was in flight, and only reports Saved when nothing newer is in the page', () => {
  let s = run([{ type: 'EDIT', edit: { body: 'two' } }, { type: 'SAVE_STARTED' }], opened());
  assert.equal(s.save.status, 'saving');
  const sent = { title: 'T', body: 'two' };
  const confirmed = note({ body: 'two', rev: 2, updatedAt: '2026-09-24T10:01:00.000Z' });
  const same = screenReducer(s, { type: 'SAVE_OK', note: confirmed, sent });
  assert.equal(same.save.status, 'saved');
  assert.equal(same.note.rev, 2);
  s = screenReducer(s, { type: 'EDIT', edit: { body: 'two and more' } });
  const newer = screenReducer(s, { type: 'SAVE_OK', note: confirmed, sent });
  assert.equal(newer.save.status, 'idle', 'still dirty: autosave sends the rest');
  assert.equal(newer.draft.body, 'two and more');
  assert.equal(isDirty(newer.note, newer.draft), true);
});

test('a stale write is a conflict: nothing is overwritten until Keep mine or Load theirs', () => {
  const theirs = note({ body: 'theirs', rev: 3, updatedAt: '2026-09-24T10:05:00.000Z' });
  const s = run([{ type: 'EDIT', edit: { body: 'mine' } }, { type: 'SAVE_STARTED' }, { type: 'SAVE_CONFLICT', theirs }], opened());
  assert.equal(s.save.status, 'conflict');
  assert.equal(s.draft.body, 'mine');
  assert.equal(s.note.rev, 1);
  // Compare toggles only in a conflict.
  assert.equal(screenReducer(s, { type: 'TOGGLE_COMPARE' }).comparing, true);
  assert.equal(screenReducer(opened(), { type: 'TOGGLE_COMPARE' }).comparing, false);
  // Keep mine: their rev becomes the base, my text stays, and it is dirty again so autosave sends it.
  const keep = screenReducer(s, { type: 'KEEP_MINE' });
  assert.equal(keep.note.rev, 3);
  assert.equal(keep.draft.body, 'mine');
  assert.equal(keep.save.status, 'idle');
  assert.equal(isDirty(keep.note, keep.draft), true);
  // Load theirs: their text replaces mine.
  const load = screenReducer(s, { type: 'LOAD_THEIRS' });
  assert.equal(load.draft.body, 'theirs');
  assert.equal(load.save.status, 'saved');
  assert.equal(isDirty(load.note, load.draft), false);
  // Choosing with no conflict does nothing.
  const calm = opened();
  assert.equal(screenReducer(calm, { type: 'KEEP_MINE' }), calm);
  assert.equal(screenReducer(calm, { type: 'LOAD_THEIRS' }), calm);
});

test('a "conflict" where the other tab saved the very same text is not a conflict', () => {
  const theirs = note({ body: 'same', rev: 2 });
  const s = run([{ type: 'EDIT', edit: { body: 'same' } }, { type: 'SAVE_CONFLICT', theirs }], opened());
  assert.equal(s.save.status, 'saved');
  assert.equal(s.note.rev, 2);
});

test('a failed save keeps the text and waits for Retry; typing more does not clear the failure', () => {
  const s = run([{ type: 'EDIT', edit: { body: 'two' } }, { type: 'SAVE_STARTED' }, { type: 'SAVE_FAILED', message: 'The disk is full', code: 'DISK_FULL' }], opened());
  assert.equal(s.save.status, 'failed');
  assert.equal(s.draft.body, 'two');
  assert.equal(screenReducer(s, { type: 'EDIT', edit: { body: 'two more' } }).save.status, 'failed');
});

test('indicator wording follows the six states of the design', () => {
  assert.match(indicatorOf({ status: 'saving' }, true, false).text, /^Saving/);
  const saved = indicatorOf({ status: 'saved', at: '2026-09-24T12:41:00' }, false, false);
  assert.equal(saved.tone, 'ok');
  assert.match(saved.text, /^Saved on this machine · \d{1,2}:\d{2}/);
  assert.equal(indicatorOf({ status: 'idle' }, true, false).text, 'Unsaved changes');
  assert.equal(indicatorOf({ status: 'conflict', theirs: note() }, true, false).text, 'This note changed in another tab');
  assert.equal(indicatorOf({ status: 'failed', message: 'x', code: 'DISK_FULL' }, true, false).text, 'Not saved · disk full');
  assert.equal(indicatorOf({ status: 'saved', at: 'x' }, false, true).text, 'Read-only history');
  assert.equal(failureReason('WEIRD', 'because'), 'because');
  assert.equal(clock('not a date'), '');
});

test('life of a note: Draft, Plan ready, Plan out of date, Ran', () => {
  assert.deepEqual(statusTag('draft', false), { label: 'Draft', tone: 'draft' });
  assert.deepEqual(statusTag('plan-ready', false), { label: 'Plan ready', tone: 'ready' });
  assert.deepEqual(statusTag('plan-ready', true), { label: 'Plan out of date', tone: 'stale' });
  assert.deepEqual(statusTag('ran', true), { label: 'Ran', tone: 'run' });
});

test('the view: a ran note is read-only with its process; the list row follows what is typed', () => {
  const ran = opened(note({ status: 'ran', processId: 'p-1' }));
  const v = buildEditorView(ran);
  assert.equal(v.readOnly, true);
  assert.equal(v.ranNote, 'Process p-1');
  const typed = screenReducer(opened(), { type: 'EDIT', edit: { title: 'New title' } });
  assert.equal(buildRows(typed)[0].title, 'New title');
  assert.equal(buildRows(typed)[0].active, true);
  assert.equal(buildEditorView(initialScreen), null);
  assert.equal(buildRows(run([{ type: 'LIST_LOADED', rows: [rowOf(note({ title: '  ' }))] }]))[0].title, 'Untitled note');
});

test('the note to open on load: the one in the address if it exists, else the most recent, else none', () => {
  const rows = [rowOf(note({ id: 'a' })), rowOf(note({ id: 'b' }))];
  assert.equal(pickInitial(rows, 'b'), 'b');
  assert.equal(pickInitial(rows, 'gone'), 'a');
  assert.equal(pickInitial(rows, null), 'a');
  assert.equal(pickInitial([], 'a'), null);
});

test('list follows saves without a refetch, newest first, and drops a deleted note', () => {
  const older = rowOf(note({ id: 'a', updatedAt: '2026-09-24T09:00:00.000Z' }));
  const newer = rowOf(note({ id: 'b', updatedAt: '2026-09-24T11:00:00.000Z' }));
  let s = run([{ type: 'LIST_LOADED', rows: [newer, older] }]);
  s = screenReducer(s, { type: 'LIST_UPSERT', row: { ...older, updatedAt: '2026-09-24T12:00:00.000Z' } });
  assert.deepEqual(s.list.rows.map((r) => r.id), ['a', 'b']);
  s = screenReducer(s, { type: 'LIST_REMOVE', id: 'a' });
  assert.deepEqual(s.list.rows.map((r) => r.id), ['b']);
});

test('compare: lines only in mine, only in theirs, and shared, in order', () => {
  const kinds = (a, b) => compareLines(a, b).map((l) => `${l.kind[0]}:${l.text}`);
  assert.deepEqual(kinds('a\nb\nc', 'a\nb\nc'), ['s:a', 's:b', 's:c']);
  assert.deepEqual(kinds('a\nmine\nc', 'a\ntheirs\nc'), ['s:a', 'm:mine', 't:theirs', 's:c']);
  assert.deepEqual(kinds('a\nb', 'a\nb\nextra'), ['s:a', 's:b', 't:extra']);
  assert.deepEqual(kinds('x\ny\nz', 'y\nz\nw'), ['m:x', 's:y', 's:z', 't:w']);
  assert.deepEqual(kinds('', ''), ['s:']);
  const big = Array.from({ length: 3000 }, (_, i) => `l${i}`).join('\n');
  assert.equal(compareLines(big, `${big}\nq`).length > 0, true);
});
