import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { handleBrowse } from './dirBrowse.mjs';
import { getSettings, getBrowseRoots, updateSettings } from './settings.mjs';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';

const CLIENT = 'http://localhost:3000';
const base = makeTempDir('dirbrowse-srv-');
const root = path.join(base, 'root');
fs.mkdirSync(path.join(root, 'proj'), { recursive: true });
fs.mkdirSync(path.join(base, 'outside'));
fs.writeFileSync(path.join(root, 'proj', 'architecture.yml'), 'version: 1\n');
const ctx = { clientOrigin: CLIENT, roots: [root] };

test('200 lists directories with marker flags', () => {
  const r = handleBrowse({ path: root }, { ...ctx, origin: CLIENT });
  assert.equal(r.status, 200);
  assert.equal(r.body.entries[0].name, 'proj');
  assert.equal(r.body.entries[0].isConstructProject, true);
});

test('no Origin header (same-origin/tool) is allowed; foreign Origin is 403 before any FS access', () => {
  assert.equal(handleBrowse({ path: root }, ctx).status, 200);
  const r = handleBrowse({ path: root }, { ...ctx, origin: 'http://evil.example' });
  assert.equal(r.status, 403);
  assert.equal(r.body.entries, undefined);
});

test('traversal and out-of-root paths are 403; array/garbage params are 400', () => {
  assert.equal(handleBrowse({ path: `${root}/../outside` }, ctx).status, 403);
  assert.equal(handleBrowse({ path: '/' }, ctx).status, 403);
  assert.equal(handleBrowse({ path: ['a', 'b'] }, ctx).status, 400);
  assert.equal(handleBrowse({ path: 'x\0y' }, ctx).status, 400);
});

test('browseRoots setting: default is home + project parent; custom roots validated and resettable', () => {
  const before = getSettings();
  try {
    assert.deepEqual(getBrowseRoots(), [os.homedir(), path.dirname(before.projectDir)]);
    updateSettings({ browseRoots: [root] });
    assert.deepEqual(getSettings().browseRoots, [root]);
    assert.throws(() => updateSettings({ browseRoots: [path.join(base, 'nope')] }), /Not a directory/);
    assert.throws(() => updateSettings({ browseRoots: 'x' }), /array/);
    assert.deepEqual(getSettings().browseRoots, [root], 'failed update leaves setting unchanged');
  } finally {
    updateSettings({ browseRoots: [] });
  }
  assert.deepEqual(getBrowseRoots(), [os.homedir(), path.dirname(before.projectDir)]);
});
