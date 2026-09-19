import test from 'node:test';
import assert from 'node:assert/strict';
import { shellCommandSpecs } from './ShellCommands.ts';
import { SCREENS } from './Screens.ts';
import { MODES } from './Modes.ts';
import { SHORTCUTS } from './Shortcuts.ts';

const specs = shellCommandSpecs(SCREENS, MODES, SHORTCUTS);

test('ids are unique and every spec has a title and group', () => {
  assert.equal(new Set(specs.map((s) => s.id)).size, specs.length);
  for (const s of specs) {
    assert.ok(s.title && s.group, s.id);
  }
});

test('there is a go-to command for every screen and a switch command for every mode', () => {
  for (const screen of SCREENS) {
    assert.ok(specs.some((s) => s.action.type === 'navigate' && s.action.href === screen.href && s.group === 'Go to'), screen.label);
  }
  for (const mode of MODES) assert.ok(specs.some((s) => s.id === `mode.${mode.id}`), mode.label);
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
