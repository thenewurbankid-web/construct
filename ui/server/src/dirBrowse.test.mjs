import '../../../test-utils/workspaceRoot.mjs';
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
fs.mkdirSync(path.join(root, 'proj', 'src'));
fs.mkdirSync(path.join(root, 'plain'));
fs.mkdirSync(path.join(root, '.hidden'));
const ctx = { clientOrigin: CLIENT, roots: [root] };

test('200 lists directories with marker flags', () => {
  const r = handleBrowse({ path: root }, { ...ctx, origin: CLIENT });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.entries.map((e) => e.name), ['plain', 'proj']);
  assert.equal(r.body.entries.find((e) => e.name === 'proj').isConstructProject, true);
  assert.equal(r.body.entries.find((e) => e.name === 'plain').isConstructProject, false);
  assert.equal(r.body.parent, null);
});

test('#568: no path lists the workspace root; any deeper or other path is the same 403 as an outside one', () => {
  assert.equal(handleBrowse({}, ctx).body.path, fs.realpathSync(root));
  const outside = handleBrowse({ path: '/etc' }, ctx);
  for (const p of [path.join(root, 'proj'), 'proj', path.join(root, 'proj', 'src')]) {
    const r = handleBrowse({ path: p }, ctx);
    assert.equal(r.status, 403, p);
    assert.deepEqual(r.body, outside.body, p);
  }
});

test('#568: hidden folders are never listed, even when asked for', () => {
  const r = handleBrowse({ showHidden: 'true' }, ctx);
  assert.equal(r.body.entries.some((e) => e.name.startsWith('.')), false);
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

