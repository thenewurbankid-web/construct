'use client';

import { useMemo, type ReactNode } from 'react';
import { DirectoryBrowserController } from '@/features/directory-browser';
import { ProcessesController, useProcesses } from '@/features/processes';
import { useOpenPalette } from '@/features/command-palette';
import { DiagnosticsController, LogsController, statusText, statusTextChars, tabBadge, useDiagnostics } from '@/features/diagnostics';
import { PANE_LIMITS } from '../domain/LayoutDefaults';
import { PRIMARY_SCREENS } from '../domain/PrimaryScreens';
import { SHORTCUTS } from '../domain/Shortcuts';
import { useActiveTabs } from '../hooks/useActiveTabs';
import { useNarrowLayout } from '../hooks/useNarrowLayout';
import { useGitBranchCount } from '../hooks/useGitBranchCount';
import type { useProjectSwitcher } from '../hooks/useProjectSwitcher';
import { useRailCollapsed } from '../hooks/useRailCollapsed';
import { useRevealPanes } from '../hooks/useRevealPanes';
import { useShellLayout } from '../hooks/useShellLayout';
import type { useShellRoute } from '../hooks/useShellRoute';
import { useShellTabs } from '../hooks/useShellTabs';
import { useShellShortcuts } from '../hooks/useShellShortcuts';
import { useDrawerActions } from '../hooks/useDrawerActions';
import { ShellDrawerContext } from '../hooks/useShellDrawer';
import { ShellFocusContext } from '../hooks/useShellFocus';
import { useFocusMode } from '../hooks/useFocusMode';
import { ShellStageContext } from '../hooks/useShellStage';
import { ShellToolsContext } from '../hooks/useShellTools';
import { useShellCommands } from '../hooks/useShellCommands';
import { useShellNavigation } from '../hooks/useShellNavigation';
import { useFaviconMotion } from '../hooks/useFaviconMotion';
import { useWorking } from '../hooks/useWorking';
import type { useTheme } from '../hooks/useTheme';
import { ProjectInfoPanel } from '../components/ProjectInfoPanel';
import { ProjectSwitcher } from '../components/ProjectSwitcher';
import { ShellPage } from '../pages/ShellPage';
import type { ModelStatus, ShellRegion, ShellTab } from '../types';

// Fixed for the lifetime of the app: how much room the validate readout reserves (#252).
const STATUS_CHARS = statusTextChars();

type Route = ReturnType<typeof useShellRoute>;
type Project = ReturnType<typeof useProjectSwitcher>;
type FrameProps = { children: ReactNode; route: Route; project: Project; model: ModelStatus; theme: ReturnType<typeof useTheme>; userMenu: ReactNode };

/** The full shell, shown only while a project is open. */
export function ShellFrame({ children, route, project, model, theme, userMenu }: FrameProps) {
  const { collapsed: railCollapsed, toggle: toggleRail } = useRailCollapsed();
  // Focus mode (#456): the Pages Editor's live preview asks the chrome to stand down.
  const focus = useFocusMode();
  const { layout, resize, toggle } = useShellLayout(project.dir, project.known);
  const narrow = useNarrowLayout(route.pathname);
  const { active, select } = useActiveTabs();
  useShellShortcuts(toggle);
  const openPalette = useOpenPalette();
  const diagnostics = useDiagnostics(project.known);
  const processes = useProcesses(project.known ? project.dir : null);
  const working = useWorking(processes.running);
  useFaviconMotion(working);
  const gitBranches = useGitBranchCount(project.known);
  const registered = { browser: useShellTabs('browser'), tools: useShellTabs('tools'), drawer: useShellTabs('drawer') };

  const { navigate, openPage } = useShellNavigation(route.pathname);
  useRevealPanes(project.known, project.dir, { left: registered.browser.length > 0, right: registered.tools.length > 0 }, toggle);

  // Default tabs the shell itself provides; features add more via useRegisterShellTab.
  const defaults = useMemo<Record<ShellRegion, ShellTab[]>>(
    () => ({
      browser: [],
      tools: [
        {
          id: 'project',
          title: 'Project',
          render: () => <ProjectInfoPanel dir={project.dir} screenLabel={route.screen?.label ?? null} modelStatus={model} shortcuts={SHORTCUTS} />,
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
          render: () => <ProcessesController api={processes} />,
        },
      ],
    }),
    [route.pathname, route.screen, project.dir, model, diagnostics, openPage, processes],
  );
  const tabs = {
    // A screen's own tabs come first (they are what you came to use); the shell's defaults follow.
    browser: [...registered.browser, ...defaults.browser],
    tools: [...registered.tools, ...defaults.tools],
    drawer: [...defaults.drawer, ...registered.drawer],
  };

  const { showDrawerTab } = useDrawerActions(toggle, select);
  const drawerApi = useMemo(() => ({ openProcesses: () => showDrawerTab('processes'), openLogs: () => showDrawerTab('logs') }), [showDrawerTab]);
  const { setPane } = narrow;
  const stageApi = useMemo(() => ({ showStage: () => setPane('mid') }), [setPane]);
  const toolsApi = useMemo(() => ({ showTool: (id: string) => { toggle('right', true); select('tools', id); setPane('right'); } }), [toggle, select, setPane]);
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
      onCloseProject={project.closeProject}
      picker={<DirectoryBrowserController onSelect={project.choose} />}
    />
  );

  return (
    <ShellPage
      layout={layout}
      limits={PANE_LIMITS}
      onResize={resize}
      onTogglePane={toggle}
      narrow={narrow.narrow}
      narrowPane={narrow.pane}
      onNarrowPane={narrow.setPane}
      focus={focus.focused}
      screens={PRIMARY_SCREENS}
      activeScreenId={route.screen?.id ?? null}
      screenBadges={{ git: gitBranches }}
      railCollapsed={railCollapsed}
      onToggleRail={toggleRail}
      projectSwitcher={projectSwitcher}
      userMenu={userMenu}
      modelStatus={model}
      runningProcesses={processes.running}
      working={working}
      onOpenProcesses={() => showDrawerTab('processes')}
      onOpenPalette={openPalette}
      validateStatus={statusText(diagnostics.state)}
      validateStatusChars={STATUS_CHARS}
      onOpenDiagnostics={() => showDrawerTab('diagnostics')}
      shortcuts={SHORTCUTS}
      tabs={tabs}
      activeTabs={active}
      onSelectTab={select}
    >
      <ShellDrawerContext.Provider value={drawerApi}>
        <ShellStageContext.Provider value={stageApi}>
          <ShellToolsContext.Provider value={toolsApi}>
            <ShellFocusContext.Provider value={focus}>{children}</ShellFocusContext.Provider>
          </ShellToolsContext.Provider>
        </ShellStageContext.Provider>
      </ShellDrawerContext.Provider>
    </ShellPage>
  );
}

