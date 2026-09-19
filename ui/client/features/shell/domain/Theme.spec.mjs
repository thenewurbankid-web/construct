import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTheme, toggleTheme, DEFAULT_THEME } from './Theme.ts';
import { THEME_INIT_SCRIPT, THEME_STORAGE_KEY } from './ThemeInit.ts';

test('dark is the default and unknown values fall back to it', () => {
  assert.equal(DEFAULT_THEME, 'dark');
  for (const v of [undefined, null, '', 'Light', 'blue', 42, {}]) assert.equal(parseTheme(v), 'dark');
  assert.equal(parseTheme('light'), 'light');
  assert.equal(parseTheme('dark'), 'dark');
});

test('toggleTheme flips between the two themes', () => {
  assert.equal(toggleTheme('dark'), 'light');
  assert.equal(toggleTheme('light'), 'dark');
});

test('init script reads the storage key and only writes validated values', () => {
  assert.ok(THEME_INIT_SCRIPT.includes(THEME_STORAGE_KEY));
  const attrs = {};
  const doc = { documentElement: { setAttribute: (k, v) => (attrs[k] = v) } };
  const run = (stored, throws = false) => {
    const localStorage = {
      getItem: () => {
        if (throws) throw new Error('blocked');
        return stored;
      },
    };
    new Function('localStorage', 'document', THEME_INIT_SCRIPT)(localStorage, doc);
    return attrs['data-theme'];
  };
  assert.equal(run('light'), 'light');
  assert.equal(run('"><script>'), 'dark');
  assert.equal(run(null), 'dark');
  assert.equal(run(null, true), 'dark');
});
