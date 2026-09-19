import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { listDirectories, detectProject, DirBrowseError } from '../src/dir-browser.mjs';

function fixture() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'dirbrowse-')));
  const root = path.join(base, 'root');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(path.join(root, 'construct-app'), { recursive: true });
  fs.writeFileSync(path.join(root, 'construct-app', 'architecture.yml'), 'version: 1\n');
  fs.mkdirSync(path.join(root, 'react-app'));
  fs.writeFileSync(path.join(root, 'react-app', 'package.json'), JSON.stringify({ dependencies: { react: '^19' } }));
  fs.mkdirSync(path.join(root, 'plain'));
  fs.mkdirSync(path.join(root, '.hidden'));
  fs.writeFileSync(path.join(root, 'secret.txt'), 'top secret');
  fs.mkdirSync(path.join(outside, 'private'), { recursive: true });
  return { base, root, outside };
}
const status = (fn) => {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof DirBrowseError);
    return e.status;
  }
  return assert.fail('expected throw');
};

test('lists only directories, sorted, with marker flags, hidden excluded', () => {
  const { root } = fixture();
  const r = listDirectories({ path: root, roots: [root] });
  assert.deepEqual(r.entries.map((e) => e.name), ['construct-app', 'plain', 'react-app']);
  const by = Object.fromEntries(r.entries.map((e) => [e.name, e]));
  assert.equal(by['construct-app'].isConstructProject, true);
  assert.equal(by['construct-app'].hasArchitectureYml, true);
  assert.equal(by['react-app'].isReact, true);
  assert.equal(by['react-app'].hasPackageJson, true);
  assert.equal(by.plain.hasPackageJson, false);
  assert.equal(r.parent, null, 'root has no navigable parent');
  assert.ok(!JSON.stringify(r).includes('secret.txt'), 'no file names leak');
  assert.ok(!JSON.stringify(r).includes('top secret'), 'no contents leak');
});

test('showHidden includes dot directories', () => {
  const { root } = fixture();
  const r = listDirectories({ path: root, roots: [root], showHidden: true });
  assert.ok(r.entries.some((e) => e.name === '.hidden'));
});

test('default path is the first root; subdir has parent', () => {
  const { root } = fixture();
  assert.equal(listDirectories({ roots: [root] }).path, root);
  assert.equal(listDirectories({ path: path.join(root, 'plain'), roots: [root] }).parent, root);
});

test('path traversal with .. is 403', () => {
  const { root, outside } = fixture();
  assert.equal(status(() => listDirectories({ path: path.join(root, '..', 'outside'), roots: [root] })), 403);
  assert.equal(status(() => listDirectories({ path: path.join(root, 'plain', '..', '..'), roots: [root] })), 403);
  assert.equal(status(() => listDirectories({ path: outside, roots: [root] })), 403);
  assert.equal(status(() => listDirectories({ path: '/etc', roots: [root] })), 403);
});

test('prefix-sibling of a root is not inside it', () => {
  const { base, root } = fixture();
  fs.mkdirSync(path.join(base, 'root-evil'));
  assert.equal(status(() => listDirectories({ path: path.join(base, 'root-evil'), roots: [root] })), 403);
});

test('symlink escaping the root: not listed, and not enterable', () => {
  const { root, outside } = fixture();
  fs.symlinkSync(path.join(outside, 'private'), path.join(root, 'escape'));
  fs.symlinkSync(path.join(root, 'plain'), path.join(root, 'inside-link'));
  const r = listDirectories({ path: root, roots: [root] });
  assert.ok(!r.entries.some((e) => e.name === 'escape'));
  assert.ok(r.entries.some((e) => e.name === 'inside-link'));
  assert.equal(status(() => listDirectories({ path: path.join(root, 'escape'), roots: [root] })), 403);
});

test('symlinked architecture.yml is not trusted as a marker', () => {
  const { root } = fixture();
  fs.symlinkSync('/etc/hostname', path.join(root, 'plain', 'architecture.yml'));
  assert.equal(detectProject(path.join(root, 'plain')).hasArchitectureYml, false);
});

test('bad input: 400 for NUL/non-string/file, 404 for missing inside root, 403 with no usable roots', () => {
  const { root } = fixture();
  assert.equal(status(() => listDirectories({ path: 'a\0b', roots: [root] })), 400);
  assert.equal(status(() => listDirectories({ path: 42, roots: [root] })), 400);
  assert.equal(status(() => listDirectories({ path: path.join(root, 'secret.txt'), roots: [root] })), 400);
  assert.equal(status(() => listDirectories({ path: path.join(root, 'nope'), roots: [root] })), 404);
  assert.equal(status(() => listDirectories({ path: root, roots: [] })), 403);
  assert.equal(status(() => listDirectories({ path: root, roots: ['/does/not/exist'] })), 403);
});

test('pagination caps and reports truncation', () => {
  const { root } = fixture();
  for (let i = 0; i < 12; i++) fs.mkdirSync(path.join(root, `d${String(i).padStart(2, '0')}`));
  const p1 = listDirectories({ path: root, roots: [root], limit: 5 });
  assert.equal(p1.entries.length, 5);
  assert.equal(p1.truncated, true);
  assert.equal(p1.total, 15);
  const p3 = listDirectories({ path: root, roots: [root], limit: 5, offset: 10 });
  assert.equal(p3.entries.length, 5);
  assert.equal(p3.truncated, false);
  assert.equal(listDirectories({ path: root, roots: [root], limit: 99999 }).limit, 500);
});
