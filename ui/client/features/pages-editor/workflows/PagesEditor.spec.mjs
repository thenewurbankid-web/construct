import test from 'node:test';
import assert from 'node:assert/strict';
import { initialPagesEditorState, pagesEditorReducer } from './PagesEditor.ts';

test('#809: a failed files fetch clears the loading spinner instead of hanging on it forever', () => {
  const loading = pagesEditorReducer(initialPagesEditorState, { type: 'SET_FEATURE', feature: 'people' });
  assert.equal(loading.filesLoading, true);

  const failed = pagesEditorReducer(loading, { type: 'FILES_ERROR', error: 'Could not load files for this feature.' });
  assert.equal(failed.filesLoading, false);
  assert.deepEqual(failed.files, []);
  assert.equal(failed.error, 'Could not load files for this feature.');
});

test('#809: re-picking the already-active feature is a no-op, not a second "Loading..." with nothing to clear it', () => {
  const picked = pagesEditorReducer(initialPagesEditorState, { type: 'SET_FEATURE', feature: 'people' });
  const loaded = pagesEditorReducer(picked, { type: 'FILES_LOADED', files: ['ProfilePage.tsx'] });
  const opened = pagesEditorReducer(loaded, { type: 'OPEN_FILE', file: 'ProfilePage.tsx' });
  assert.equal(opened.filesLoading, false);

  const reselected = pagesEditorReducer(opened, { type: 'SET_FEATURE', feature: 'people' });
  assert.deepEqual(reselected, opened);
  assert.equal(reselected.filesLoading, false);
});
