'use client';

import { useMemo, type ReactNode } from 'react';
import { DirectoryBrowserController } from '@/features/directory-browser';
import { CommandPaletteController, CommandRegistryProvider, useOpenPalette } from '@/features/command-palette';
import { DiagnosticsController, LogsController, statusText, tabBadge, useDiagnostics } from '@/features/diagnostics';
import { PANE_LIMITS } from '../domain/LayoutDefaults';
import { MODES } from '../domain/Modes';
import { SCREENS } from '../domain/Screens';
import { SHORTCUTS } from '../domain/Shortcuts';
import { useActiveTabs } from '../hooks/useActiveTabs';
import { useModelStatus } from '../hooks/useModelStatus';
import { useProjectSwitcher } from '../hooks/useProjectSwitcher';
import { useShellLayout } from '../hooks/useShellLayout';
import { useShellRoute } from '../hooks/useShellRoute';
import { ShellTabsProvider, useShellTabs } from '../hooks/useShellTabs';
import { useShellShortcuts } from '../hooks/useShellShortcuts';
import { useDrawerActions } from '../hooks/useDrawerActions';
import { useShellCommands } from '../hooks/useShellCommands';
import { useShellNavigation } from '../hooks/useShellNavigation';
import { useTheme } from '../hooks/useTheme';
import { EmptyPanel } from '../components/EmptyPanel';
import { ProjectInfoPanel } from '../components/ProjectInfoPanel';
import { ProjectSwitcher } from '../components/ProjectSwitcher';
import { ScreensNav } from '../components/ScreensNav';
import { ShellPage } from '../pages/ShellPage';
import { ThemeController } from './ThemeController';
import type { ShellRegion, ShellTab } from '../types';

function ShellFrame({ children }: { children: ReactNode }) {
  const route = useShellRoute();
  const project = useProjectSwitcher();
  const model = useModelStatus();
  const { layout, resize, toggle } = useShellLayout(project.dir, project.known);
  const { active, select } = useActiveTabs();
  useShellShortcuts(toggle);
  const openPalette = useOpenPalette();
  const diagnostics = useDiagnostics(project.known);
  const theme = useTheme();
  const registered = { browser: useShellTabs('browser'), tools: useShellTabs('tools'), drawer: useShellTabs('drawer') };

  const { navigate, openPage } = useShellNavigation(route.pathname);

  // Default tabs the shell itself provides; features add more via useRegisterShellTab.
  const defaults = useMemo<Record<ShellRegion, ShellTab[]>>(
    () => ({
      browser: [{ id: 'screens', title: 'Screens', render: () => <ScreensNav screens={SCREENS} pathname={route.pathname} /> }],
      tools: [
        {
          id: 'project',
          title: 'Project',
          render: () => <ProjectInfoPanel dir={project.dir} modeLabel={route.mode?.label ?? null} modelStatus={model} shortcuts={SHORTCUTS} />,
        },
      ],
      drawer: [
        {
          id: 'diagnostics',
          title: 'Diagnostics',
          badge: tabBadge(diagnostics.state),
          render: () => <DiagnosticsController diagnostics={diagnostics} onOpenPage={openPage} />,
        },
        { id: 'logs', title: 'Logs', render: () => <LogsController /> },
        {
          id: 'processes',
          title: 'Processes',
          render: () => <EmptyPanel title="No processes running" hint="Long-running work will show here with progress, pause and cancel." />,
        },
      ],
    }),
    [route.pathname, route.mode, project.dir, model, diagnostics, openPage],
  );
  const tabs = {
    browser: [...defaults.browser, ...registered.browser],
    tools: [...defaults.tools, ...registered.tools],
    drawer: [...defaults.drawer, ...registered.drawer],
  };

  const { showDrawerTab } = useDrawerActions(toggle, select);
  useShellCommands({
    navigate,
    togglePane: toggle,
    toggleTheme: theme.toggle,
    runValidate: diagnostics.run,
    openProjectSwitcher: project.show,
    showDrawerTab,
  });

  const projectSwitcher = (
    <ProjectSwitcher
      label={project.label}
      dir={project.dir}
      open={project.open}
      onToggle={project.toggle}
      onClose={project.close}
      error={project.error}
      picker={<DirectoryBrowserController onSelect={project.choose} initialPath={project.dir ?? undefined} />}
    />
  );

  return (
    <ShellPage
      layout={layout}
      limits={PANE_LIMITS}
      onResize={resize}
      onTogglePane={toggle}
      modes={MODES}
      activeModeId={route.mode?.id ?? null}
      projectSwitcher={projectSwitcher}
      themeToggle={<ThemeController />}
      modelStatus={model}
      runningProcesses={0}
      onOpenProcesses={() => showDrawerTab('processes')}
      onOpenPalette={openPalette}
      validateStatus={statusText(diagnostics.state)}
      onOpenDiagnostics={() => showDrawerTab('diagnostics')}
      shortcuts={SHORTCUTS}
      tabs={tabs}
      activeTabs={active}
      onSelectTab={select}
    >
      {children}
    </ShellPage>
  );
}

/** The Cockpit frame: top bar, Browser | stage | Tools panes, bottom drawer and
 * status bar around every screen. Mount once, in the root layout. */
export function ShellController({ children }: { children: ReactNode }) {
  return (
    <CommandRegistryProvider>
      <ShellTabsProvider>
        <ShellFrame>{children}</ShellFrame>
        <CommandPaletteController />
      </ShellTabsProvider>
    </CommandRegistryProvider>
  );
}
