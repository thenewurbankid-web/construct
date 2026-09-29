import test from 'node:test';
import assert from 'node:assert/strict';
import { initialSave, saveReducer } from './Save.ts';

test('typing a name resets an error and returns to idle', () => {
  const errored = saveReducer(initialSave, { type: 'PREVIEW_FAIL', error: 'boom' });
  const typed = saveReducer(errored, { type: 'NAME', name: 'scaffold-checkout' });
  assert.equal(typed.status, 'idle');
  assert.equal(typed.error, null);
  assert.equal(typed.name, 'scaffold-checkout');
});

test('preview -> ready -> save -> saved is a clean run', () => {
  const previewing = saveReducer(initialSave, { type: 'START' });
  assert.equal(previewing.status, 'previewing');
  const ready = saveReducer(previewing, { type: 'PREVIEW_OK' });
  assert.equal(ready.status, 'ready');
  const saving = saveReducer(ready, { type: 'SAVE' });
  assert.equal(saving.status, 'saving');
  const saved = saveReducer(saving, { type: 'SAVE_OK' });
  assert.equal(saved.status, 'saved');
});

test('a preview or save failure carries its error and Cancel clears it', () => {
  const failed = saveReducer(initialSave, { type: 'PREVIEW_FAIL', error: 'invalid' });
  assert.equal(failed.status, 'error');
  assert.equal(failed.error, 'invalid');
  const cancelled = saveReducer(failed, { type: 'CANCEL' });
  assert.equal(cancelled.status, 'idle');
  assert.equal(cancelled.error, null);
});

test('RESET returns to the initial state regardless of where it was', () => {
  const mid = saveReducer(initialSave, { type: 'SAVE' });
  assert.deepEqual(saveReducer(mid, { type: 'RESET' }), initialSave);
});
