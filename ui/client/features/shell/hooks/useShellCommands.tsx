'use client';

import { useMemo } from 'react';
import { useRegisterCommands, type Command } from '@/features/command-palette';
import { MODES } from '../domain/Modes';
import { SCREENS } from '../domain/Screens';
import { SHORTCUTS } from '../domain/Shortcuts';
import { shellCommandSpecs, type ShellCommandAction } from '../domain/ShellCommands';

type Handlers = {
  navigate: (href: string) => void;
  togglePane: (pane: 'left' | 'right' | 'drawer') => void;
  toggleTheme: () => void;
  runValidate: () => void;
  openProjectSwitcher: () => void;
  showDrawerTab: (tab: 'diagnostics' | 'logs' | 'processes') => void;
};

function runAction(action: ShellCommandAction, h: Handlers): void {
  switch (action.type) {
    case 'navigate':
      return h.navigate(action.href);
    case 'toggle-pane':
      return h.togglePane(action.pane);
    case 'toggle-theme':
      return h.toggleTheme();
    case 'run-validate':
      // Show the results where they will appear, then run.
      h.showDrawerTab('diagnostics');
      return h.runValidate();
    case 'open-project-switcher':
      return h.openProjectSwitcher();
    case 'show-drawer-tab':
      return h.showDrawerTab(action.tab);
  }
}

/** Registers the shell's own commands (go to a screen, switch mode, toggle
 * theme/panes/drawer, run validate, open the project switcher) into the palette. */
export function useShellCommands({ navigate, togglePane, toggleTheme, runValidate, openProjectSwitcher, showDrawerTab }: Handlers): void {
  const commands = useMemo<Command[]>(() => {
    const handlers: Handlers = { navigate, togglePane, toggleTheme, runValidate, openProjectSwitcher, showDrawerTab };
    return shellCommandSpecs(SCREENS, MODES, SHORTCUTS).map(({ action, ...rest }) => ({ ...rest, run: () => runAction(action, handlers) }));
  }, [navigate, togglePane, toggleTheme, runValidate, openProjectSwitcher, showDrawerTab]);
  useRegisterCommands(commands);
}
