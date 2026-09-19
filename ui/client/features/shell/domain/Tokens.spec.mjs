// WCAG AA contrast guard for the design tokens (Design module #244).
// Parses app/tokens.css directly, so editing a colour without re-checking
// contrast fails `npm test`.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { contrastRatio, parseColor } from './Contrast.ts';

const css = fs.readFileSync(new URL('../../../app/tokens.css', import.meta.url), 'utf8');

function block(selectorStart) {
  const start = css.indexOf(selectorStart);
  assert.ok(start >= 0, `block ${selectorStart} exists`);
  return css.slice(start, css.indexOf('\n}', start));
}

function tokensOf(text) {
  const out = {};
  for (const m of text.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

const THEMES = {
  dark: tokensOf(block(":root[data-theme='dark']")),
  light: tokensOf(block(":root[data-theme='light']")),
};

const SURFACES = ['surface-0', 'surface-1', 'surface-2', 'surface-3', 'canvas'];

for (const [name, t] of Object.entries(THEMES)) {
  const c = (key, over) => parseColor(t[key], over ? parseColor(t[over]) : undefined);

  test(`${name}: body and secondary text reach 4.5:1 on every surface`, () => {
    for (const s of SURFACES) {
      for (const fg of ['text', 'text-muted', 'text-faint']) {
        const r = contrastRatio(c(fg), c(s));
        assert.ok(r >= 4.5, `${name} ${fg} on ${s} = ${r.toFixed(2)}`);
      }
    }
  });

  test(`${name}: status and accent colours used as text reach 4.5:1 on panes`, () => {
    for (const s of ['surface-0', 'surface-1', 'surface-2', 'surface-3']) {
      for (const fg of ['accent', 'success', 'warn', 'danger', 'llm']) {
        const r = contrastRatio(c(fg), c(s));
        assert.ok(r >= 4.5, `${name} ${fg} on ${s} = ${r.toFixed(2)}`);
      }
    }
  });

  test(`${name}: text on the accent fill (active nav, primary button) reaches 4.5:1`, () => {
    const r = contrastRatio(c('accent-fg'), c('accent'));
    assert.ok(r >= 4.5, `${name} accent-fg on accent = ${r.toFixed(2)}`);
  });

  test(`${name}: focus ring reaches 3:1 against every surface`, () => {
    for (const s of SURFACES) {
      const r = contrastRatio(c('focus'), c(s));
      assert.ok(r >= 3, `${name} focus on ${s} = ${r.toFixed(2)}`);
    }
  });

  test(`${name}: tokens defined for both themes stay in sync`, () => {
    const other = name === 'dark' ? THEMES.light : THEMES.dark;
    assert.deepEqual(Object.keys(t).sort(), Object.keys(other).sort());
  });
}
