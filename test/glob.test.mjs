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

// #491: `**/` dissolves to optional (minimatch/gitignore semantics).
test('a/**/b matches zero intervening segments as well as nested ones (#491)', () => {
  assert.ok(matchGlob('app/**/page.tsx', 'app/page.tsx'));
  assert.ok(matchGlob('app/**/page.tsx', 'app/dashboard/page.tsx'));
  assert.ok(matchGlob('app/**/page.tsx', 'app/a/b/page.tsx'));
  assert.ok(!matchGlob('app/**/page.tsx', 'app/other.tsx'));
  assert.ok(!matchGlob('app/**/page.tsx', 'xapp/page.tsx'));
});

test('a trailing ** and a leading **/ keep their meaning (#491)', () => {
  assert.ok(matchGlob('features/*/pages/**', 'features/cart/pages/a.tsx'));
  assert.ok(matchGlob('**/page.tsx', 'page.tsx'));
  assert.ok(matchGlob('**/page.tsx', 'a/b/page.tsx'));
  assert.ok(matchGlob('src/**.ts', 'src/a/b.ts'));
});
