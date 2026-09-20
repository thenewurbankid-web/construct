import test from 'node:test';
import assert from 'node:assert/strict';
import { crumbsFor } from './Crumbs.ts';

test('the root alone is a single "Workspace" crumb', () => {
  assert.deepEqual(crumbsFor('/home/dev/workspace', '/home/dev/workspace'), [{ label: 'Workspace', path: '/home/dev/workspace' }]);
  assert.deepEqual(crumbsFor('/home/dev/workspace/', '/home/dev/workspace'), [{ label: 'Workspace', path: '/home/dev/workspace' }]);
});

test('nested folders add one crumb each, with full paths for navigation', () => {
  assert.deepEqual(crumbsFor('/ws', '/ws/shop/features'), [
    { label: 'Workspace', path: '/ws' },
    { label: 'shop', path: '/ws/shop' },
    { label: 'features', path: '/ws/shop/features' },
  ]);
});

test('a path outside the root, or only sharing its prefix, yields no crumbs', () => {
  assert.deepEqual(crumbsFor('/ws', '/etc'), []);
  assert.deepEqual(crumbsFor('/ws', '/ws-evil/x'), []);
  assert.deepEqual(crumbsFor(null, '/ws'), []);
});

test('windows-style roots', () => {
  assert.deepEqual(crumbsFor('C:\\ws', 'C:\\ws\\a'), [{ label: 'Workspace', path: 'C:\\ws' }, { label: 'a', path: 'C:\\ws\\a' }]);
});
