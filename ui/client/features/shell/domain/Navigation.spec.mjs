import test from 'node:test';
import assert from 'node:assert/strict';
import { addTab, badgeText, removeTab, resolveActiveTab } from './TabRegistry.ts';
import { nextTabId } from './TabKeys.ts';
import { PRIMARY_SCREENS, primaryScreenForPath } from './PrimaryScreens.ts';
import { shellCommandSpecs } from './ShellCommands.ts';
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

test('resolveActiveTab: a preferred enabled tab wins over the first, but not over an explicit pick', () => {
  const tabs = [tab('a'), tab('b', { preferred: true }), tab('c', { preferred: true, disabled: true })];
  assert.equal(resolveActiveTab(tabs, null).id, 'b');
  assert.equal(resolveActiveTab(tabs, 'a').id, 'a');
  assert.equal(resolveActiveTab([tab('a'), tab('p', { preferred: true, disabled: true })], null).id, 'a');
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

test('the five primary screens are Features, Pages, Components, Git, Tests, and every existing route belongs to one or to the profile menu', () => {
  assert.deepEqual(PRIMARY_SCREENS.map((s) => s.label), ['Features', 'Pages', 'Components', 'Git', 'Tests']);
  assert.deepEqual(PRIMARY_SCREENS.map((s) => s.href), ['/', '/pages', '/workflows', '/review', '/tests']);
  for (const p of ['/', '/plan', '/dashboard', '/wizard']) assert.equal(primaryScreenForPath(p).id, 'features', p);
  assert.equal(primaryScreenForPath('/pages').id, 'pages');
  assert.equal(primaryScreenForPath('/workflows').id, 'components');
  assert.equal(primaryScreenForPath('/review').id, 'git');
  assert.equal(primaryScreenForPath('/tests').id, 'tests');
  // Settings, Local model and Help live in the profile menu: no primary screen is current there.
  for (const p of ['/settings', '/ollama', '/help', '/states']) assert.equal(primaryScreenForPath(p), null, p);
  // Every route a former nav entry pointed at is either owned by a screen or a profile-menu page.
  const profile = new Set(['/settings', '/ollama', '/help']);
  for (const s of SCREENS) for (const r of s.activeOn) assert.ok(primaryScreenForPath(r) || profile.has(r), r);
});

test('the palette offers Go to <screen> for the five screens once, and keeps the other routes reachable', () => {
  const specs = shellCommandSpecs(PRIMARY_SCREENS, SCREENS, []);
  const titles = specs.map((c) => c.title);
  for (const label of ['Features', 'Pages', 'Components', 'Git', 'Tests']) assert.equal(titles.filter((t) => t === `Go to ${label}`).length, 1, label);
  for (const label of ['Settings', 'Local Model', 'Help']) assert.ok(titles.includes(`Go to ${label}`), label);
  assert.equal(new Set(specs.map((c) => c.id)).size, specs.length, 'command ids are unique');
  assert.ok(!titles.some((t) => /\bmode\b/i.test(t)), 'the modes are gone from the palette');
});

test('screens list every existing route with the old nav labels', () => {
  assert.deepEqual(SCREENS.map((s) => s.label), ['Dashboard', 'Import Wizard', 'Pages Editor', 'Workflows', 'Tests', 'Local Model', 'Settings', 'Help']);
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

// #252: the tab a background job feeds must be the same width whatever it finds,
// or finishing shoves every tab after it sideways.
test('badgeText caps a count so the badge never changes width', () => {
  assert.equal(badgeText(0), '0');
  assert.equal(badgeText(7), '7');
  assert.equal(badgeText(99), '99');
  assert.equal(badgeText(100), '99+');
  assert.equal(badgeText(7412), '99+');
  assert.ok(badgeText(7412).length <= 3, 'never wider than the three characters .sh-badge reserves');
  assert.equal(badgeText('new'), 'new', 'a feature may still label its own badge');
});
