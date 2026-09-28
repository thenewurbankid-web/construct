import test from 'node:test';
import assert from 'node:assert/strict';
import { screenIndexFromKey, shortcutAction } from './Shortcuts.ts';

const key = (k, extra = {}) => ({ key: k, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...extra });

test('F6 cycles panes forward, Shift+F6 cycles them back', () => {
  assert.equal(shortcutAction(key('F6')), 'cycle-pane');
  assert.equal(shortcutAction(key('F6', { shiftKey: true })), 'cycle-pane-back');
  assert.equal(shortcutAction(key('F6', { ctrlKey: true })), null);
});

test('Alt 1-5 goes to a screen; other Alt+digit and Alt+letter do not', () => {
  for (const k of ['1', '2', '3', '4', '5']) assert.equal(shortcutAction(key(k, { altKey: true })), 'go-to-screen');
  assert.equal(shortcutAction(key('6', { altKey: true })), null);
  assert.equal(shortcutAction(key('0', { altKey: true })), null);
  assert.equal(shortcutAction(key('b', { ctrlKey: true, altKey: true })), 'toggle-right');
});

test('screenIndexFromKey: 1-5 map to 0-based indices, everything else is null', () => {
  assert.equal(screenIndexFromKey('1'), 0);
  assert.equal(screenIndexFromKey('5'), 4);
  assert.equal(screenIndexFromKey('6'), null);
  assert.equal(screenIndexFromKey('0'), null);
  assert.equal(screenIndexFromKey('a'), null);
});

test('Ctrl B / Ctrl Alt B / Ctrl J still work unchanged', () => {
  assert.equal(shortcutAction(key('b', { ctrlKey: true })), 'toggle-left');
  assert.equal(shortcutAction(key('b', { ctrlKey: true, altKey: true })), 'toggle-right');
  assert.equal(shortcutAction(key('j', { ctrlKey: true })), 'toggle-drawer');
  assert.equal(shortcutAction(key('j', { ctrlKey: true, shiftKey: true })), null);
});
