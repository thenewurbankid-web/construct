import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTheme, toggleTheme, DEFAULT_THEME } from './Theme.ts';
import { parseThemePreference, resolveTheme } from './ThemePreference.ts';
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
  const run = (stored, throws = false, prefersLight = false) => {
    const localStorage = {
      getItem: () => {
        if (throws) throw new Error('blocked');
        return stored;
      },
    };
    const win = { matchMedia: () => ({ matches: prefersLight }) };
    new Function('localStorage', 'document', 'window', THEME_INIT_SCRIPT)(localStorage, doc, win);
    return attrs['data-theme'];
  };
  assert.equal(run('light'), 'light');
  assert.equal(run('"><script>'), 'dark');
  assert.equal(run(null), 'dark');
  assert.equal(run(null, true), 'dark');
  assert.equal(run('system', false, true), 'light');
  assert.equal(run('system', false, false), 'dark');
});

test('a preference is dark, light or system; system follows the operating system', () => {
  assert.equal(parseThemePreference('system'), 'system');
  assert.equal(parseThemePreference('light'), 'light');
  assert.equal(parseThemePreference('nonsense'), 'dark');
  assert.equal(resolveTheme('system', true), 'light');
  assert.equal(resolveTheme('system', false), 'dark');
  assert.equal(resolveTheme('dark', true), 'dark');
});
