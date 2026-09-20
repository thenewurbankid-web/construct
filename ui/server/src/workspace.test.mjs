import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { makeTempDir } from '../../../test-utils/tmpdir.mjs';
import path from 'node:path';
import {
  contain, containOrNull, isInside, relativeToWorkspace, resolveWorkspaceRoot, WorkspaceError, MAX_PATH_LENGTH,
} from './workspace.mjs';

let tmp;
let ws; // the workspace root (real path)
let outside; // a sibling directory of the workspace, and of a decoy that shares its name prefix
let evil; // `<tmp>/ws-evil`: shares the string prefix of the workspace

before(() => {
  tmp = makeTempDir('construct-ws-');
  ws = path.join(tmp, 'ws');
  outside = path.join(tmp, 'outside');
  evil = path.join(tmp, 'ws-evil');
  for (const d of [ws, outside, evil, path.join(ws, 'proj', 'src'), path.join(ws, 'a b'), path.join(ws, 'ünï-ｃｏｄｅ-日本')]) fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(ws, 'proj', 'file.txt'), 'x');
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'secret');
  fs.symlinkSync(outside, path.join(ws, 'link-out')); // symlink that escapes
  fs.symlinkSync(evil, path.join(ws, 'link-evil'));
  fs.symlinkSync(path.join(ws, 'proj'), path.join(ws, 'link-in')); // symlink that stays inside
  fs.symlinkSync(path.join(tmp, 'does-not-exist'), path.join(ws, 'dangling'));
  fs.symlinkSync(path.join(ws, 'loop-b'), path.join(ws, 'loop-a'));
  fs.symlinkSync(path.join(ws, 'loop-a'), path.join(ws, 'loop-b'));
  fs.symlinkSync(ws, path.join(tmp, 'ws-alias')); // another spelling of the root
});

after(() => fs.rmSync(tmp, { recursive: true, force: true }));

const refused = (fn, status, code) => assert.throws(fn, (e) => e instanceof WorkspaceError && e.status === status && (!code || e.code === code));

test('isInside is segment-aware and exact', () => {
  assert.equal(isInside('/ws', '/ws'), true);
  assert.equal(isInside('/ws', '/ws/a/b'), true);
  assert.equal(isInside('/ws', '/ws-evil'), false);
  assert.equal(isInside('/ws', '/ws-evil/x'), false);
  assert.equal(isInside('/ws', '/'), false);
  assert.equal(isInside('/ws', '/ws/..foo'), true, 'a directory literally named "..foo" is inside');
  assert.equal(isInside('/ws/a', '/ws'), false);
});

test('the root itself, a child, a relative child and a dot-segment path are allowed and resolved against the ROOT', () => {
  assert.equal(contain(ws, ws), ws);
  assert.equal(contain(ws, path.join(ws, 'proj')), path.join(ws, 'proj'));
  assert.equal(contain(ws, 'proj'), path.join(ws, 'proj'));
  assert.equal(contain(ws, './proj/./src/'), path.join(ws, 'proj', 'src'));
  assert.equal(contain(ws, 'proj/src/..'), path.join(ws, 'proj'));
  assert.equal(contain(ws, '.'), ws);
});

test('a relative request never resolves against process.cwd()', () => {
  const before = process.cwd();
  process.chdir(outside);
  try {
    assert.equal(contain(ws, 'proj'), path.join(ws, 'proj'));
    refused(() => contain(ws, 'secret.txt'), 404);
  } finally {
    process.chdir(before);
  }
});

test('`..` traversal is refused, however it is spelled', () => {
  refused(() => contain(ws, '..'), 403, 'OUTSIDE_WORKSPACE');
  refused(() => contain(ws, '../outside'), 403);
  refused(() => contain(ws, 'proj/../../outside'), 403);
  refused(() => contain(ws, path.join(ws, '..', 'outside')), 403);
  refused(() => contain(ws, `${ws}/proj/../../outside/secret.txt`), 403);
  refused(() => contain(ws, 'proj/../../../../../../../../etc/passwd'), 403);
  refused(() => contain(ws, '../ws-evil'), 403);
});

test('absolute paths elsewhere are refused, existing or not (no existence oracle)', () => {
  refused(() => contain(ws, '/'), 403);
  refused(() => contain(ws, '/etc'), 403);
  refused(() => contain(ws, '/etc/passwd'), 403);
  refused(() => contain(ws, '/definitely/not/here'), 403);
  refused(() => contain(ws, outside), 403);
  refused(() => contain(ws, path.join(outside, 'secret.txt')), 403);
  refused(() => contain(ws, os.homedir()), 403);
});

test('sibling-prefix: /ws-evil is not inside /ws', () => {
  refused(() => contain(ws, evil), 403);
  refused(() => contain(ws, `${ws}-evil`), 403);
  refused(() => contain(ws, path.join(evil, 'anything')), 403);
});

test('a symlink that leaves the workspace is refused (directory, file behind it, and a not-yet-existing child)', () => {
  refused(() => contain(ws, 'link-out'), 403);
  refused(() => contain(ws, 'link-out/secret.txt'), 403);
  refused(() => contain(ws, 'link-out/newdir', { mustExist: false }), 403);
  // Lexically `link-out/..` is the workspace itself (we act on the collapsed path, never the raw string), so this
  // names a not-yet-existing workspace child: refused as missing, and never resolved through the link.
  refused(() => contain(ws, 'link-out/../outside'), 404);
  assert.equal(contain(ws, 'link-out/../outside', { mustExist: false }), path.join(ws, 'outside'));
  refused(() => contain(ws, 'link-evil'), 403);
});

test('a symlink that stays inside is allowed and returns its REAL path', () => {
  assert.equal(contain(ws, 'link-in'), path.join(ws, 'proj'));
  assert.equal(contain(ws, 'link-in/src'), path.join(ws, 'proj', 'src'));
});

test('the workspace may be reached through another spelling of itself (a symlink to the root)', () => {
  assert.equal(contain(ws, path.join(tmp, 'ws-alias', 'proj')), path.join(ws, 'proj'));
});

test('dangling symlinks and symlink loops are refused', () => {
  refused(() => contain(ws, 'dangling', { mustExist: false }), 403);
  refused(() => contain(ws, 'dangling/child', { mustExist: false }), 403);
  refused(() => contain(ws, 'loop-a'), 403);
  refused(() => contain(ws, 'loop-a/x', { mustExist: false }), 403);
});

test('nonexistent paths: 404 when it must exist, allowed (real ancestor + tail) when it need not', () => {
  refused(() => contain(ws, 'nope'), 404, 'NOT_FOUND');
  refused(() => contain(ws, 'proj/nope/deeper', { mustBeDir: true }), 404);
  assert.equal(contain(ws, 'proj/new/deeper', { mustExist: false }), path.join(ws, 'proj', 'new', 'deeper'));
  // Through a symlink that stays inside, the not-yet-existing tail is re-rooted on the real target.
  assert.equal(contain(ws, 'link-in/new', { mustExist: false }), path.join(ws, 'proj', 'new'));
});

test('file vs directory', () => {
  refused(() => contain(ws, 'proj/file.txt', { mustBeDir: true }), 400, 'NOT_DIRECTORY');
  assert.equal(contain(ws, 'proj/file.txt', { mustBeFile: true }), path.join(ws, 'proj', 'file.txt'));
  refused(() => contain(ws, 'proj', { mustBeFile: true }), 400, 'NOT_FILE');
  refused(() => contain(ws, 'proj/file.txt/child', { mustBeDir: true }), 404);
});

test('NUL bytes, empty, non-strings and absurd lengths are refused before touching the disk', () => {
  refused(() => contain(ws, 'proj\0/../../etc'), 400, 'BAD_PATH');
  refused(() => contain(ws, `${ws}\0`), 400);
  refused(() => contain(ws, ''), 400);
  for (const bad of [undefined, null, 5, {}, [], ['proj'], true]) refused(() => contain(ws, bad), 400);
  refused(() => contain(ws, 'a'.repeat(MAX_PATH_LENGTH + 1)), 400);
  refused(() => contain(ws, `${'a/'.repeat(3000)}x`), 400);
  // A single path component over NAME_MAX, under the length cap: refused, not a crash.
  assert.equal(containOrNull(ws, 'b'.repeat(300)), null);
});

test('unicode, spaces and odd-but-legal names', () => {
  assert.equal(contain(ws, 'a b'), path.join(ws, 'a b'));
  assert.equal(contain(ws, 'ünï-ｃｏｄｅ-日本'), path.join(ws, 'ünï-ｃｏｄｅ-日本'));
  // Full-width dots and unicode lookalikes are just names, not traversal.
  assert.equal(contain(ws, '．．/x', { mustExist: false }), path.join(ws, '．．', 'x'));
  refused(() => contain(ws, 'ünï-ｃｏｄｅ-日本/../../outside'), 403);
});

test('trailing dots, slashes and repeated separators do not change the verdict', () => {
  assert.equal(contain(ws, 'proj/'), path.join(ws, 'proj'));
  assert.equal(contain(ws, 'proj//src///'), path.join(ws, 'proj', 'src'));
  assert.equal(contain(ws, 'proj/.'), path.join(ws, 'proj'));
  refused(() => contain(ws, '..//'), 403);
  refused(() => contain(ws, '../'), 403);
  refused(() => contain(ws, './../'), 403);
  // "outside." is a different name from "outside": a lookalike must not be treated as it.
  refused(() => contain(ws, path.join(tmp, 'outside.')), 403);
});

test('case variants of an existing directory are judged on the real path (no case trick)', () => {
  const probe = path.join(ws, 'PROJ');
  const exists = fs.existsSync(probe); // true only on a case-insensitive filesystem
  if (exists) assert.equal(contain(ws, probe), path.join(ws, 'proj'));
  else refused(() => contain(ws, probe), 404);
  refused(() => contain(ws, path.join(tmp, 'WS-EVIL')), 403);
});

test('containOrNull returns null for a refusal and rethrows nothing for WorkspaceError', () => {
  assert.equal(containOrNull(ws, '../outside'), null);
  assert.equal(containOrNull(ws, 'proj'), path.join(ws, 'proj'));
});

test('a path swapped for a symlink AFTER it was chosen is caught the next time it is checked (TOCTOU per use)', () => {
  const swap = path.join(ws, 'swap');
  fs.mkdirSync(swap);
  assert.equal(contain(ws, swap, { mustBeDir: true }), swap);
  fs.rmSync(swap, { recursive: true });
  fs.symlinkSync(outside, swap);
  refused(() => contain(ws, swap, { mustBeDir: true }), 403);
  fs.unlinkSync(swap);
});

test('relativeToWorkspace gives a forward-slash breadcrumb path', () => {
  assert.equal(relativeToWorkspace(ws, ws), '');
  assert.equal(relativeToWorkspace(ws, path.join(ws, 'proj', 'src')), 'proj/src');
});

test('resolveWorkspaceRoot: env wins, default is $HOME/workspace, created if missing, realpath\'d', () => {
  const made = path.join(tmp, 'made-on-demand', 'deep');
  assert.equal(resolveWorkspaceRoot({ CONSTRUCT_WORKSPACE_ROOT: made }), made);
  assert.ok(fs.statSync(made).isDirectory());
  assert.equal(resolveWorkspaceRoot({ CONSTRUCT_WORKSPACE_ROOT: path.join(tmp, 'ws-alias') }), ws, 'a symlinked root is resolved to its real path');
  const home = path.join(tmp, 'home');
  fs.mkdirSync(home);
  assert.equal(resolveWorkspaceRoot({}, { home }), path.join(home, 'workspace'));
  assert.equal(resolveWorkspaceRoot({ CONSTRUCT_WORKSPACE_ROOT: '  ' }, { home }), path.join(home, 'workspace'));
});

test('resolveWorkspaceRoot refuses a relative root, a NUL byte, the filesystem root and a file', () => {
  assert.throws(() => resolveWorkspaceRoot({ CONSTRUCT_WORKSPACE_ROOT: 'relative/dir' }), /absolute/);
  assert.throws(() => resolveWorkspaceRoot({ CONSTRUCT_WORKSPACE_ROOT: '/tmp/x\0y' }), /absolute/);
  assert.throws(() => resolveWorkspaceRoot({ CONSTRUCT_WORKSPACE_ROOT: '/' }), /filesystem root/);
  assert.throws(() => resolveWorkspaceRoot({ CONSTRUCT_WORKSPACE_ROOT: path.join(ws, 'proj', 'file.txt') }));
});
