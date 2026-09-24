import test from 'node:test';
import assert from 'node:assert/strict';
import { canChoose, breadcrumbs, chooseHint } from './ProjectPaths.ts';

test('a route question accepts a folder with a page and any code file, not a plain folder', () => {
  assert.equal(canChoose('route', { kind: 'dir', route: true }), true);
  assert.equal(canChoose('route', { kind: 'file', route: false }), true);
  assert.equal(canChoose('route', { kind: 'dir', route: false }), false);
});

test('a folder question accepts any folder and no file', () => {
  assert.equal(canChoose('dir', { kind: 'dir', route: false }), true);
  assert.equal(canChoose('dir', { kind: 'file', route: false }), false);
});

test('breadcrumbs lead from the project root to the folder', () => {
  assert.deepEqual(breadcrumbs(''), []);
  assert.deepEqual(breadcrumbs('src/app'), [{ name: 'src', path: 'src' }, { name: 'app', path: 'src/app' }]);
});

test('a hint explains a route row that cannot be chosen, and is empty otherwise', () => {
  assert.match(chooseHint('route', { kind: 'dir', route: false }), /no page file/);
  assert.equal(chooseHint('route', { kind: 'dir', route: true }), '');
  assert.equal(chooseHint('dir', { kind: 'dir', route: false }), '');
});
