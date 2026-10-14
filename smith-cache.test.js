// S10: toEnglish is memoized by hash of (code, kind, options): pure, in memory.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { toEnglish: toEnglishAnyStyle, clearEnglishCache, englishCacheStats } = require('./to-english');
// These tests pin the original word-for-word reading: { style: 'exact' }.
const toEnglish = (code, kind, options = {}) => toEnglishAnyStyle(code, kind, { style: 'exact', ...options });


const code = `function run(a) {\n  return a.equals(1);\n}`;

test('a repeat call is a cache hit with an identical result', () => {
  clearEnglishCache();
  const first = toEnglish(code, 'function');
  const second = toEnglish(code, 'function');
  assert.deepEqual(second, first);
  assert.deepEqual(englishCacheStats(), { hits: 1, misses: 1, size: 1, limit: 500 });
});

test('kind and options are part of the key', () => {
  clearEnglishCache();
  toEnglish(code, 'function');
  toEnglish(code, 'function', { all: true });
  toEnglish(`run(a) {\n  return a;\n}`, 'method');
  assert.equal(englishCacheStats().misses, 3);
  assert.ok(toEnglish(code, 'function', { all: true }).functions);
  assert.equal(toEnglish(code, 'function').functions, undefined);
});

test('mutating a returned result does not corrupt the cache', () => {
  clearEnglishCache();
  const r = toEnglish(code, 'function');
  r.steps[0].english = 'tampered';
  r.steps.push({});
  const again = toEnglish(code, 'function');
  assert.equal(again.steps.length, 1);
  assert.equal(again.steps[0].english, 'return a equals 1');
});

test('parse errors are not cached and still throw every time', () => {
  clearEnglishCache();
  assert.throws(() => toEnglish('const x = ;', 'function'));
  assert.throws(() => toEnglish('const x = ;', 'function'));
  assert.equal(englishCacheStats().size, 0);
});

test('the cache is bounded: the least recently used entry is evicted', () => {
  clearEnglishCache();
  const fn = (i) => `function f${i}(a) {\n  return a;\n}`;
  toEnglish(fn(0), 'function');
  for (let i = 1; i <= 500; i++) toEnglish(fn(i), 'function');
  const stats = englishCacheStats();
  assert.equal(stats.size, 500);
  toEnglish(fn(0), 'function'); // evicted -> a miss again
  assert.equal(englishCacheStats().misses, stats.misses + 1);
});
