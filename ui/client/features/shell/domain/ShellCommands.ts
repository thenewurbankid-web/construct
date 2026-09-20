// Pure (DOMAIN-001): the commands the shell itself puts in the palette, as
// data. The hook that registers them maps each `action` to a real handler, so
// this list is testable without React.
import type { PrimaryScreen, ShellScreen, ShortcutInfo } from '../types.ts';

export type ShellCommandAction =
  | { type: 'navigate'; href: string }
  | { type: 'toggle-pane'; pane: 'left' | 'right' | 'drawer' }
  | { type: 'toggle-theme' }
  | { type: 'run-validate' }
  | { type: 'open-project-switcher' }
  | { type: 'show-drawer-tab'; tab: 'diagnostics' | 'logs' | 'processes' };

export type ShellCommandSpec = {
  id: string;
  title: string;
  keywords: string[];
  group: string;
  hint?: string;
  action: ShellCommandAction;
};

const hintFor = (shortcuts: ShortcutInfo[], action: ShortcutInfo['action']) => shortcuts.find((s) => s.action === action)?.keys;

/** `primary` are the five top-bar screens ("Go to Git"); `others` are the remaining routes (Settings, Local Model,
 * Help, the Import Wizard...), so every screen stays reachable from the palette. A route a primary screen already
 * owns is listed once. */
export function shellCommandSpecs(primary: PrimaryScreen[], others: ShellScreen[], shortcuts: ShortcutInfo[]): ShellCommandSpec[] {
  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const owned = new Set(primary.map((p) => p.href));
  return [
    ...primary.map<ShellCommandSpec>((p) => ({
      id: `screen.${p.id}`,
      title: `Go to ${p.label}`,
      keywords: ['open', 'screen', 'navigate', ...(p.id === 'git' ? ['review', 'branches', 'pull request'] : []), ...(p.id === 'features' ? ['plan', 'notes', 'dashboard'] : [])],
      group: 'Go to',
      action: { type: 'navigate', href: p.href },
    })),
    ...others
      .filter((s) => !owned.has(s.href))
      .map<ShellCommandSpec>((s) => ({
        id: `go.${slug(s.label)}`,
        title: `Go to ${s.label}`,
        keywords: ['open', 'screen', 'page', 'navigate'],
        group: 'Go to',
        action: { type: 'navigate', href: s.href },
      })),
    { id: 'view.toggle-theme', title: 'Toggle dark / light theme', keywords: ['theme', 'colour', 'color', 'appearance', 'dark', 'light'], group: 'View', action: { type: 'toggle-theme' } },
    { id: 'view.toggle-browser', title: 'Show or hide the Browser pane', keywords: ['left', 'sidebar', 'panel'], group: 'View', hint: hintFor(shortcuts, 'toggle-left'), action: { type: 'toggle-pane', pane: 'left' } },
    { id: 'view.toggle-tools', title: 'Show or hide the Tools panel', keywords: ['right', 'inspector', 'panel'], group: 'View', hint: hintFor(shortcuts, 'toggle-right'), action: { type: 'toggle-pane', pane: 'right' } },
    { id: 'view.toggle-drawer', title: 'Show or hide the drawer', keywords: ['bottom', 'diagnostics', 'logs'], group: 'View', hint: hintFor(shortcuts, 'toggle-drawer'), action: { type: 'toggle-pane', pane: 'drawer' } },
    { id: 'drawer.diagnostics', title: 'Show Diagnostics', keywords: ['problems', 'violations', 'errors', 'validate'], group: 'Drawer', action: { type: 'show-drawer-tab', tab: 'diagnostics' } },
    { id: 'drawer.logs', title: 'Show Logs', keywords: ['output', 'console', 'commands'], group: 'Drawer', action: { type: 'show-drawer-tab', tab: 'logs' } },
    { id: 'drawer.processes', title: 'Show Processes', keywords: ['running', 'jobs', 'tasks'], group: 'Drawer', action: { type: 'show-drawer-tab', tab: 'processes' } },
    { id: 'project.validate', title: 'Run validate', keywords: ['check', 'rules', 'architecture', 'diagnostics', 'lint', 'construct validate'], group: 'Project', action: { type: 'run-validate' } },
    { id: 'project.switch', title: 'Open project switcher', keywords: ['change', 'folder', 'directory', 'project'], group: 'Project', action: { type: 'open-project-switcher' } },
  ];
}
