import test from 'node:test';
import assert from 'node:assert/strict';
import { addTab, removeTab, resolveActiveTab } from './TabRegistry.ts';
import { nextTabId } from './TabKeys.ts';
import { MODES, modeForPath } from './Modes.ts';
import { SCREENS, isScreenActive } from './Screens.ts';
import { projectLabel } from './ProjectLabel.ts';
import { shortcutAction } from './Shortcuts.ts';

const tab = (id, extra = {}) => ({ id, title: id, render: () => null, ...extra });

test('tab registry: add appends, re-adding replaces in place, remove is a no-op when absent', () => {
  let tabs = addTab([], tab('a'));
  tabs = addTab(tabs, tab('b'));
  const replaced = addTab(tabs, tab('a', { badge: 3 }));
  assert.deepEqual(replaced.map((t) => t.id), ['a', 'b']);
  assert.equal(replaced[0].badge, 3);
  assert.equal(removeTab(tabs, 'zzz'), tabs);
  assert.deepEqual(removeTab(tabs, 'a').map((t) => t.id), ['b']);
});

test('resolveActiveTab: requested if enabled, else first enabled, else null', () => {
  const tabs = [tab('a', { disabled: true }), tab('b'), tab('c')];
  assert.equal(resolveActiveTab(tabs, 'c').id, 'c');
  assert.equal(resolveActiveTab(tabs, 'a').id, 'b');
  assert.equal(resolveActiveTab(tabs, 'missing').id, 'b');
  assert.equal(resolveActiveTab(tabs, null).id, 'b');
  assert.equal(resolveActiveTab([tab('x', { disabled: true })], 'x'), null);
  assert.equal(resolveActiveTab([], null), null);
});

test('nextTabId: roving focus wraps, skips disabled, Home/End, ignores other keys', () => {
  const tabs = [tab('a'), tab('b', { disabled: true }), tab('c')];
  assert.equal(nextTabId(tabs, 'a', 'ArrowRight'), 'c');
  assert.equal(nextTabId(tabs, 'c', 'ArrowRight'), 'a');
  assert.equal(nextTabId(tabs, 'a', 'ArrowLeft'), 'c');
  assert.equal(nextTabId(tabs, 'c', 'Home'), 'a');
  assert.equal(nextTabId(tabs, 'a', 'End'), 'c');
  assert.equal(nextTabId(tabs, 'a', 'x'), null);
  assert.equal(nextTabId([], 'a', 'ArrowRight'), null);
});

test('modes keep the owner names and map paths', () => {
  assert.deepEqual(MODES.map((m) => m.label), ['Explore', 'Research', 'Build']);
  assert.equal(modeForPath('/pages').id, 'explore');
  assert.equal(modeForPath('/workflows').id, 'explore');
  assert.equal(modeForPath('/').id, 'research');
  assert.equal(modeForPath('/wizard').id, 'build');
  assert.equal(modeForPath('/settings'), null);
});

test('screens list every existing route with the old nav labels', () => {
  assert.deepEqual(SCREENS.map((s) => s.label), ['Dashboard', 'Import Wizard', 'Pages Editor', 'Workflows', 'Local Model', 'Settings', 'Help']);
  assert.equal(isScreenActive(SCREENS[0], '/'), true);
  assert.equal(isScreenActive(SCREENS[0], '/help'), false);
});

test('projectLabel: last segment, separators tolerated, empty -> No project', () => {
  assert.equal(projectLabel('/home/me/storefront'), 'storefront');
  assert.equal(projectLabel('/home/me/storefront/'), 'storefront');
  assert.equal(projectLabel('C:\\work\\shop'), 'shop');
  assert.equal(projectLabel('/'), '/');
  assert.equal(projectLabel(''), 'No project');
  assert.equal(projectLabel(null), 'No project');
});

test('shortcutAction maps Ctrl B / Ctrl Alt B / Ctrl J / F6 and nothing else', () => {
  const k = (key, o = {}) => ({ key, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...o });
  assert.equal(shortcutAction(k('b', { ctrlKey: true })), 'toggle-left');
  assert.equal(shortcutAction(k('b', { ctrlKey: true, altKey: true })), 'toggle-right');
  assert.equal(shortcutAction(k('B', { metaKey: true })), 'toggle-left');
  assert.equal(shortcutAction(k('j', { ctrlKey: true })), 'toggle-drawer');
  assert.equal(shortcutAction(k('F6')), 'cycle-pane');
  assert.equal(shortcutAction(k('b')), null);
  assert.equal(shortcutAction(k('j', { ctrlKey: true, shiftKey: true })), null);
  assert.equal(shortcutAction(k('j', { ctrlKey: true, altKey: true })), null);
});
