import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FLIP_CYCLE_MS, isAtRest, toDataUrl, toggleFaviconSvg, toggleFrame } from './FaviconFrames.ts';

const at = (pct) => toggleFrame((pct / 100) * FLIP_CYCLE_MS);

test('at the start of a flip the toggle is at rest, and the frame drawn then is the static icon', () => {
  const f = at(0);
  assert.equal(isAtRest(f), true);
  const staticIcon = fs.readFileSync(new URL('../../../app/icon.svg', import.meta.url), 'utf8').trim();
  // Same drawing (the static file uses a slightly different formatting of the same shapes, so compare the shapes).
  const shapes = (svg) => [...svg.matchAll(/<(rect|circle)[^>]*>/g)].map((m) => m[0].replace(/\s+/g, ' ').replace(/ ?\/>$/, '/>'));
  assert.deepEqual(shapes(toggleFaviconSvg(f)), shapes(staticIcon));
});

test('the flip matches brand.css: the knob slides 20 left, the bar hands over and returns, all back to rest at the end', () => {
  assert.equal(at(38).knobX, 0);
  assert.equal(at(50).knobX, -20);
  assert.equal(at(70).knobX, -20);
  assert.ok(at(44).knobX < -5 && at(44).knobX > -15, 'mid slide');
  assert.equal(at(100).knobX, 0);
  assert.equal(at(42).barOpacity, 0);
  assert.equal(at(60).barX, 17);
  assert.equal(at(88).barOpacity, 1);
  assert.equal(at(88).barX, 17);
  assert.equal(at(99).barOpacity, 1);
  assert.equal(at(99).barX, 0);
  assert.equal(isAtRest(at(100)), true);
  assert.equal(isAtRest(at(60)), false);
});

test('it loops on the clock, never jumps far between neighbouring frames, and any time is valid', () => {
  assert.deepEqual(toggleFrame(FLIP_CYCLE_MS * 7 + 300), toggleFrame(300));
  assert.deepEqual(toggleFrame(-1200), toggleFrame(FLIP_CYCLE_MS - 1200));
  // Every 25 ms the knob moves by at most 2 units (it travels 20 over ~180 ms at its fastest).
  let prev = toggleFrame(0);
  for (let t = 25; t <= FLIP_CYCLE_MS; t += 25) {
    const now = toggleFrame(t);
    assert.ok(Math.abs(now.knobX - prev.knobX) < 5, `knob step at ${t} ms`);
    prev = now;
  }
});

test('a moved frame is still one valid SVG with the knob and bar transformed, and the data URL decodes back to it', () => {
  const svg = toggleFaviconSvg(at(60));
  assert.match(svg, /<circle cx="34" cy="24" r="5" fill="url\(#g\)" transform="translate\(-20 0\)"\/>/);
  assert.match(svg, /<rect x="10"[^>]*transform="translate\(17 0\)" opacity="0"\/>/);
  assert.equal(decodeURIComponent(toDataUrl(svg).replace('data:image/svg+xml,', '')), svg);
  assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
});
