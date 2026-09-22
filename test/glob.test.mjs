import { test } from 'node:test';
import assert from 'node:assert/strict';
import { globToRegExp, matchGlob } from '../packages/core/glob.mjs';
import { matchGlob as enforcerMatchGlob } from '../packages/core/architecture-enforcer.mjs';

test('** crosses directories, * does not', () => {
  assert.ok(matchGlob('features/*/pages/**', 'features/cart/pages/a/b.tsx'));
  assert.ok(matchGlob('src/*.ts', 'src/a.ts'));
  assert.ok(!matchGlob('src/*.ts', 'src/x/a.ts'));
  assert.ok(!matchGlob('features/*/pages/**', 'features/cart/hooks/a.tsx'));
});

test('globToRegExp is anchored', () => {
  assert.ok(!globToRegExp('a/*').test('x/a/b'));
});

test('architecture-enforcer still re-exports the same matchGlob', () => {
  assert.equal(enforcerMatchGlob, matchGlob);
});
