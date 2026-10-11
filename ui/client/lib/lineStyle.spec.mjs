import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

// cd1: the Line style tokens (lib/line-style.css) hold WCAG contrast in both themes, computed from the shipped CSS.
const css = fs.readFileSync(new URL('./line-style.css', import.meta.url), 'utf8');

function block(selectorStart) {
  const i = css.indexOf(selectorStart);
  assert.ok(i >= 0, `no block ${selectorStart}`);
  const body = css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
  return Object.fromEntries([...body.matchAll(/--(ln-[a-z0-9-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
}
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

const THEMES = { dark: block(":root[data-theme='dark']"), light: block(":root[data-theme='light']") };
const SURFACES = ['ln-bg', 'ln-surface', 'ln-surface-2'];

for (const [name, t] of Object.entries(THEMES)) {
  test(`line style (${name}): text and muted text reach 4.5:1 on every surface; the accent reaches 4.5:1 for links`, () => {
    for (const s of SURFACES) {
      for (const fg of ['ln-text', 'ln-muted', 'ln-accent']) assert.ok(ratio(t[fg], t[s]) >= 4.5, `${fg} on ${s}: ${ratio(t[fg], t[s]).toFixed(2)}`);
    }
    assert.ok(ratio(t['ln-on-accent'], t['ln-accent']) >= 4.5, 'on-accent on accent');
  });
  test(`line style (${name}): status colours and control borders reach 3:1 on every surface`, () => {
    for (const s of SURFACES) {
      for (const fg of ['ln-fit', 'ln-wait', 'ln-gap', 'ln-tie', 'ln-stub', 'ln-border-strong']) assert.ok(ratio(t[fg], t[s]) >= 3, `${fg} on ${s}: ${ratio(t[fg], t[s]).toFixed(2)}`);
    }
  });
}

test('line style: the dark theme is also the default (no data-theme), as in Cockpit', () => {
  assert.match(css, /:root,\s*:root\[data-theme='dark'\]\s*\{/);
});
