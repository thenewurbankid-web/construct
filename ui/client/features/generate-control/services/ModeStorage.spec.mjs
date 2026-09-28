import test from 'node:test';
import assert from 'node:assert/strict';

// Node's test runner has no DOM; a tiny in-memory localStorage is enough to exercise the
// try/catch-wrapped read/write path the same way OllamaModelSelection's own spec would.
function fakeStorage() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, v),
  };
}
globalThis.window = { localStorage: fakeStorage() };

const { loadMode, saveMode } = await import('./ModeStorage.ts');

test('loadMode: defaults to mechanical for an action kind never chosen before', () => {
  assert.equal(loadMode('never-seen'), 'mechanical');
});

test('saveMode/loadMode: remembered per action kind, one never bleeds into another', () => {
  saveMode('fill-a-layer', 'ai');
  assert.equal(loadMode('fill-a-layer'), 'ai');
  assert.equal(loadMode('propose-a-fix'), 'mechanical');
});

test('saveMode: overwrites only its own key, siblings keep their own choice', () => {
  saveMode('a', 'ai');
  saveMode('b', 'ai');
  saveMode('a', 'mechanical');
  assert.equal(loadMode('a'), 'mechanical');
  assert.equal(loadMode('b'), 'ai');
});
