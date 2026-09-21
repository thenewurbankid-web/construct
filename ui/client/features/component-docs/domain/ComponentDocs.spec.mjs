import test from 'node:test';
import assert from 'node:assert/strict';
import { toListItems, findComponent, docView, docReason } from './ComponentList.ts';
import { editReducer, initialEditState, isDirty } from '../workflows/ComponentEdit.ts';

const entries = [
  { name: 'BillingView', path: 'features/billing/components/BillingView.tsx', feature: 'billing' },
  { name: 'Button', path: 'components/Button.tsx', feature: null },
];

test('list rows: name, and where it lives (feature first when there is one)', () => {
  assert.deepEqual(toListItems(entries), [
    { id: 'features/billing/components/BillingView.tsx', label: 'BillingView', detail: 'billing · features/billing/components/BillingView.tsx' },
    { id: 'components/Button.tsx', label: 'Button', detail: 'components/Button.tsx' },
  ]);
  assert.equal(findComponent(entries, 'components/Button.tsx').name, 'Button');
  assert.equal(findComponent(entries, 'components/Nope.tsx'), null);
  assert.equal(findComponent(entries, null), null);
});

test('doc view: props, no docs, and reader failures are told apart', () => {
  const comp = { name: 'X', description: '', props: [{ name: 'a', type: 'string', required: true, default: null, description: '' }] };
  assert.equal(docView(null), null);
  assert.equal(docView({ ok: true, path: 'a', name: 'X', feature: null, components: [comp] }).kind, 'props');
  assert.deepEqual(docView({ ok: true, path: 'a', name: 'X', feature: null, components: [] }), { kind: 'none', note: 'No prop documentation found.' });
  assert.equal(docView({ ok: true, path: 'a', name: 'X', feature: null, components: [{ name: 'X', description: '', props: [] }] }).kind, 'none');
  assert.equal(docView({ ok: false, code: 'PARSE_ERROR', error: 'syntax' }).kind, 'none');
  assert.equal(docView({ ok: false, code: 'DISABLED', error: 'off' }).note, 'Prop documentation is switched off for this project.');
  assert.equal(docView({ ok: false, code: 'ENGINE_ERROR', error: 'boom' }).kind, 'failed');
  assert.equal(docReason({ ok: false, code: 'PARSE_ERROR', error: 'syntax' }), 'syntax');
  assert.equal(docReason({ ok: true, path: 'a', name: 'X', feature: null, components: [] }), null);
});

const loaded = { path: 'a.tsx', source: 'one', contentHash: 'h1', editable: true };

test('edit flow: edit -> dirty -> preview -> saving -> clean with the new hash', () => {
  let s = editReducer(initialEditState, { type: 'LOAD', loaded });
  assert.equal(s.phase, 'clean');
  s = editReducer(s, { type: 'EDIT', draft: 'two' });
  assert.equal(s.phase, 'dirty');
  assert.equal(isDirty(s), true);
  s = editReducer(s, { type: 'CHECKING' });
  s = editReducer(s, { type: 'EDIT', draft: 'three' });
  assert.equal(s.draft, 'two', 'no typing while the server is checking');
  s = editReducer(s, { type: 'PREVIEW', hunks: [{ value: 'x', added: true }] });
  assert.equal(s.phase, 'preview');
  s = editReducer(s, { type: 'SAVING' });
  s = editReducer(s, { type: 'SAVED', contentHash: 'h2' });
  assert.equal(s.phase, 'clean');
  assert.equal(s.loaded.source, 'two');
  assert.equal(s.loaded.contentHash, 'h2');
  assert.equal(s.saved, true);
  s = editReducer(s, { type: 'EDIT', draft: 'four' });
  assert.equal(s.saved, false);
});

test('edit flow: typing back to the original is clean; a failure keeps the draft and says why; discard restores', () => {
  let s = editReducer(initialEditState, { type: 'LOAD', loaded });
  s = editReducer(s, { type: 'EDIT', draft: 'two' });
  s = editReducer(s, { type: 'EDIT', draft: 'one' });
  assert.equal(s.phase, 'clean');
  s = editReducer(s, { type: 'EDIT', draft: 'two' });
  s = editReducer(s, { type: 'FAILED', error: 'Save blocked', conflict: false });
  assert.equal(s.draft, 'two');
  assert.equal(s.phase, 'dirty');
  assert.equal(s.error, 'Save blocked');
  s = editReducer(s, { type: 'FAILED', error: 'changed on disk', conflict: true });
  assert.equal(s.conflict, true);
  s = editReducer(s, { type: 'DISCARD' });
  assert.equal(s.draft, 'one');
  assert.equal(s.error, null);
  assert.equal(s.conflict, false);
});

test('edit flow: a read-only file (too large) cannot be edited', () => {
  let s = editReducer(initialEditState, { type: 'LOAD', loaded: { ...loaded, editable: false } });
  s = editReducer(s, { type: 'EDIT', draft: 'two' });
  assert.equal(s.draft, 'one');
  assert.equal(s.phase, 'clean');
});
