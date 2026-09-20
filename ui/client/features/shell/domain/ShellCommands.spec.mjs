import test from 'node:test';
import assert from 'node:assert/strict';
import { shellCommandSpecs } from './ShellCommands.ts';
import { SCREENS } from './Screens.ts';
import { PRIMARY_SCREENS } from './PrimaryScreens.ts';
import { SHORTCUTS } from './Shortcuts.ts';

const specs = shellCommandSpecs(PRIMARY_SCREENS, SCREENS, SHORTCUTS);

test('ids are unique and every spec has a title and group', () => {
  assert.equal(new Set(specs.map((s) => s.id)).size, specs.length);
  for (const s of specs) {
    assert.ok(s.title && s.group, s.id);
  }
});

test('every screen and every top-bar screen has a Go to command, and there is no mode command', () => {
  for (const screen of SCREENS) {
    assert.ok(specs.some((s) => s.action.type === 'navigate' && s.action.href === screen.href && s.group === 'Go to'), screen.label);
  }
  for (const screen of PRIMARY_SCREENS) assert.ok(specs.some((s) => s.id === `screen.${screen.id}` && s.title === `Go to ${screen.label}`), screen.label);
  assert.ok(!specs.some((s) => s.group === 'Mode' || s.id.startsWith('mode.')));
});

test('the required actions exist: theme, panes, drawer, validate, project switcher', () => {
  const kinds = new Set(specs.map((s) => s.action.type));
  for (const k of ['toggle-theme', 'toggle-pane', 'run-validate', 'open-project-switcher', 'show-drawer-tab']) assert.ok(kinds.has(k), k);
  const panes = specs.filter((s) => s.action.type === 'toggle-pane').map((s) => s.action.pane).sort();
  assert.deepEqual(panes, ['drawer', 'left', 'right']);
});

test('pane toggles carry their real shortcut as a hint', () => {
  assert.equal(specs.find((s) => s.id === 'view.toggle-drawer').hint, 'Ctrl J');
  assert.equal(specs.find((s) => s.id === 'view.toggle-browser').hint, 'Ctrl B');
});
