// Run: cd ui/client && npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { typeFits, normalizeTypeText } from './ScopeBinding.ts';

test('an unknown type on either side is never a mismatch (never falsely disable)', () => {
  assert.equal(typeFits(null, 'string'), true);
  assert.equal(typeFits('string', null), true);
  assert.equal(typeFits(null, null), true);
});

test('a known, matching type fits', () => {
  assert.equal(typeFits('string', 'string'), true);
  assert.equal(typeFits('() => void', '() => void'), true);
});

test('a known, differing type is a real, provable mismatch', () => {
  assert.equal(typeFits('string', 'number'), false);
  assert.equal(typeFits('(value) => void', 'boolean'), false);
});

test('whitespace in the annotation text does not cause a false mismatch', () => {
  assert.equal(typeFits('string  ', ' string'), true);
  assert.equal(normalizeTypeText('  a   b\n'), 'a b');
});
