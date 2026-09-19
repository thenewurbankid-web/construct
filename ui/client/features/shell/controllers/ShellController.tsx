'use client';

import { useCallback, useMemo, type ReactNode } from 'react';
import { DirectoryBrowserController } from '@/features/directory-browser';
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
  const registered = { browser: useShellTabs('browser'), tools: useShellTabs('tools'), drawer: useShellTabs('drawer') };

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
        { id: 'diagnostics', title: 'Diagnostics', render: () => <EmptyPanel title="No diagnostics yet" hint="Validation results will appear here in plain language." /> },
        { id: 'logs', title: 'Logs', render: () => <EmptyPanel title="No logs yet" hint="Output from commands you run will collect here." /> },
        {
          id: 'processes',
          title: 'Processes',
          render: () => <EmptyPanel title="No processes running" hint="Long-running work will show here with progress, pause and cancel." />,
        },
      ],
    }),
    [route.pathname, route.mode, project.dir, model],
  );
  const tabs = {
    browser: [...defaults.browser, ...registered.browser],
    tools: [...defaults.tools, ...registered.tools],
    drawer: [...defaults.drawer, ...registered.drawer],
  };

  const openProcesses = useCallback(() => {
    toggle('drawer', true);
    select('drawer', 'processes');
  }, [toggle, select]);

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
      onOpenProcesses={openProcesses}
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
    <ShellTabsProvider>
      <ShellFrame>{children}</ShellFrame>
    </ShellTabsProvider>
  );
}
