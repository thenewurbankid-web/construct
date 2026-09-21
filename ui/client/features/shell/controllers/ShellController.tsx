'use client';

import type { ReactNode } from 'react';
import { UserMenuController } from '@/features/auth';
import { CommandPaletteController, CommandRegistryProvider } from '@/features/command-palette';
import { ProjectGateController } from '@/features/project-gate';
import { LoadingState } from '@/features/states';
import { shellMode } from '../domain/ProjectRequirement';
import { useModelStatus } from '../hooks/useModelStatus';
import { useProjectSwitcher } from '../hooks/useProjectSwitcher';
import { useShellRoute } from '../hooks/useShellRoute';
import { ShellTabsProvider } from '../hooks/useShellTabs';
import { useTheme } from '../hooks/useTheme';
import { ProfileMenuItems } from '../components/ProfileMenuItems';
import { ShellRootPage } from '../pages/ShellRootPage';
import { ShellFrame } from './ShellFrame';

/** Picks the frame for the state of the open project (#429): the full shell while one is open; with none, a
 * minimal top bar over the full-screen "Open a project" gate (or, for Settings / Local model / Help, the page
 * itself). The frame's elements are built here but only the chosen one is rendered, so nothing of the full
 * shell (panes, drawer, palette, its data fetches) runs while no project is open. */
function ShellRoot({ children }: { children: ReactNode }) {
  const route = useShellRoute();
  const project = useProjectSwitcher();
  const model = useModelStatus();
  const theme = useTheme();
  const mode = shellMode(project.known, project.dir, route.pathname);
  const userMenu = (
    <UserMenuController>
      <ProfileMenuItems pathname={route.pathname} modelStatus={model} preference={theme.preference} onPreference={theme.setPreference} />
    </UserMenuController>
  );
  return (
    <ShellRootPage
      mode={mode}
      userMenu={userMenu}
      full={
        <ShellFrame route={route} project={project} model={model} theme={theme} userMenu={userMenu}>
          {children}
        </ShellFrame>
      }
      palette={<CommandPaletteController />}
      gate={<ProjectGateController>{null}</ProjectGateController>}
      loading={
        <div className="page page--screen">
          <LoadingState label="Loading" hint="Checking which project is open." />
        </div>
      }
    >
      {children}
    </ShellRootPage>
  );
}

/** The Cockpit frame: with a project open, the top bar, the screens rail, Browser | stage | Tools panes,
 * bottom drawer and status bar around every screen; with none, only the full-screen "Open a project" gate under
 * a minimal top bar. Mount once, in the root layout. */
export function ShellController({ children }: { children: ReactNode }) {
  return (
    <CommandRegistryProvider>
      <ShellTabsProvider>
        <ShellRoot>{children}</ShellRoot>
      </ShellTabsProvider>
    </CommandRegistryProvider>
  );
}
