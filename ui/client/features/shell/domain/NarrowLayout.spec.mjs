import test from 'node:test';
import assert from 'node:assert/strict';
import { NARROW_BREAKPOINT, NARROW_MEDIA_QUERY, isNarrowWidth } from './NarrowLayout.ts';
import { DEFAULT_NARROW_PANE, NARROW_PANES, nextNarrowPane } from './NarrowPanes.ts';

test('narrow layout: below 900px only; 900 and up keeps three panes', () => {
  assert.equal(NARROW_BREAKPOINT, 900);
  assert.equal(isNarrowWidth(390), true);
  assert.equal(isNarrowWidth(768), true);
  assert.equal(isNarrowWidth(899), true);
  assert.equal(isNarrowWidth(900), false);
  assert.equal(isNarrowWidth(1280), false);
  assert.equal(NARROW_MEDIA_QUERY, '(max-width: 899px)');
});

test('narrow panes: Browser, Stage, Tools in order; stage is the default', () => {
  assert.deepEqual(NARROW_PANES.map((p) => p.label), ['Browser', 'Stage', 'Tools']);
  assert.equal(DEFAULT_NARROW_PANE, 'mid');
});

test('nextNarrowPane: arrows wrap, Home/End jump, other keys ignored', () => {
  assert.equal(nextNarrowPane('mid', 'ArrowRight'), 'right');
  assert.equal(nextNarrowPane('right', 'ArrowRight'), 'left');
  assert.equal(nextNarrowPane('left', 'ArrowLeft'), 'right');
  assert.equal(nextNarrowPane('mid', 'Home'), 'left');
  assert.equal(nextNarrowPane('mid', 'End'), 'right');
  assert.equal(nextNarrowPane('mid', 'a'), null);
});
