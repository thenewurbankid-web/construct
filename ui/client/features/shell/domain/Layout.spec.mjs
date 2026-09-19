import test from 'node:test';
import assert from 'node:assert/strict';
import { clampSize, resizeByKey, sizeFromDrag } from './PaneSizing.ts';
import { layoutStorageKey, sanitizeLayout } from './LayoutState.ts';
import { DEFAULT_LAYOUT, PANE_LIMITS } from './LayoutDefaults.ts';
import { initialShellLayout, shellLayoutReducer } from '../workflows/ShellLayout.ts';

test('clampSize rounds, clamps, and survives NaN', () => {
  assert.equal(clampSize(100.4, 160, 480), 160);
  assert.equal(clampSize(9999, 160, 480), 480);
  assert.equal(clampSize(300.6, 160, 480), 301);
  assert.equal(clampSize(NaN, 160, 480), 160);
});

test('sizeFromDrag: left grows with the pointer, right/drawer grow against it', () => {
  assert.equal(sizeFromDrag(200, 40, false, 160, 480), 240);
  assert.equal(sizeFromDrag(360, 40, true, 280, 640), 320);
  assert.equal(sizeFromDrag(360, -100, true, 280, 640), 460);
  assert.equal(sizeFromDrag(200, -500, false, 160, 480), 160);
});

test('resizeByKey: arrows follow orientation and inversion, Shift = big step, Home/End', () => {
  assert.equal(resizeByKey('ArrowRight', false, 200, 160, 480, 'vertical', false), 216);
  assert.equal(resizeByKey('ArrowLeft', false, 200, 160, 480, 'vertical', false), 184);
  assert.equal(resizeByKey('ArrowLeft', false, 360, 280, 640, 'vertical', true), 376);
  assert.equal(resizeByKey('ArrowRight', true, 360, 280, 640, 'vertical', true), 296);
  assert.equal(resizeByKey('ArrowUp', false, 220, 96, 480, 'horizontal', true), 236);
  assert.equal(resizeByKey('ArrowDown', false, 220, 96, 480, 'horizontal', true), 204);
  assert.equal(resizeByKey('Home', false, 220, 96, 480, 'horizontal', true), 96);
  assert.equal(resizeByKey('End', false, 220, 96, 480, 'horizontal', true), 480);
  assert.equal(resizeByKey('a', false, 220, 96, 480, 'horizontal', true), null);
  assert.equal(resizeByKey('ArrowUp', false, 220, 96, 480, 'vertical', false), null);
});

test('sanitizeLayout: defaults for garbage, clamps sizes, keeps valid data, drops extras', () => {
  assert.deepEqual(sanitizeLayout(null), DEFAULT_LAYOUT);
  assert.deepEqual(sanitizeLayout('nope'), DEFAULT_LAYOUT);
  const out = sanitizeLayout({ left: { size: 99999, open: false }, right: { size: 'x', open: 'yes' }, evil: 1 });
  assert.equal(out.left.size, PANE_LIMITS.left.max);
  assert.equal(out.left.open, false);
  assert.deepEqual(out.right, DEFAULT_LAYOUT.right);
  assert.deepEqual(out.drawer, DEFAULT_LAYOUT.drawer);
  assert.equal('evil' in out, false);
});

test('first-run defaults: left open at the old nav width, right and drawer closed', () => {
  assert.equal(DEFAULT_LAYOUT.left.open, true);
  assert.equal(DEFAULT_LAYOUT.left.size, 200);
  assert.equal(DEFAULT_LAYOUT.right.open, false);
  assert.equal(DEFAULT_LAYOUT.drawer.open, false);
});

test('layoutStorageKey is per project', () => {
  assert.notEqual(layoutStorageKey('/a'), layoutStorageKey('/b'));
  assert.equal(layoutStorageKey('/a'), layoutStorageKey('/a'));
  assert.ok(layoutStorageKey(null).includes('default'));
});

test('reducer: RESIZE clamps, TOGGLE flips, unchanged state keeps identity, LOAD replaces', () => {
  let s = shellLayoutReducer(initialShellLayout, { type: 'RESIZE', pane: 'left', size: 10 });
  assert.equal(s.left.size, PANE_LIMITS.left.min);
  s = shellLayoutReducer(s, { type: 'RESIZE', pane: 'right', size: 400 });
  assert.equal(s.right.size, 400);
  assert.equal(shellLayoutReducer(s, { type: 'RESIZE', pane: 'right', size: 400 }), s);
  s = shellLayoutReducer(s, { type: 'TOGGLE', pane: 'drawer' });
  assert.equal(s.drawer.open, true);
  s = shellLayoutReducer(s, { type: 'TOGGLE', pane: 'drawer', open: true });
  assert.equal(s.drawer.open, true);
  assert.equal(shellLayoutReducer(s, { type: 'LOAD', layout: DEFAULT_LAYOUT }), DEFAULT_LAYOUT);
});
