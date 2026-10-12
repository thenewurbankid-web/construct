'use client';

import { CloneController } from '@/features/clone';
import { NewProjectController } from '@/features/new-project';
import { ProjectCardsPage, useProjectCards, useWorkspaceFolder } from '@/features/directory-browser';
import { OPEN_PROJECT_TABS, tabForKey } from '../domain/OpenProjectTabs';
import { useOpenProjectTab } from '../hooks/useOpenProjectTab';
import { OpenProjectPage } from '../pages/ProjectGatePage';
import type { ProjectStatus } from '../types';

/** The folder that gets the one-click "Try the sample shop" shortcut on the Open-a-project screen. */
const SAMPLE_FOLDER = 'shop';

type OpenProjectControllerProps = {
  status: ProjectStatus;
  opening: boolean;
  openError: string | null;
  onOpen: (dir: string) => void;
};

/** #365: the "Open a project" screen, mounted only while no project is open. The projects (directory-browser, scoped by
 * the server to the workspace) come first as cards; New project and From GitHub are their own features' question
 * series, each in its own tab (kept in the URL). */
export function OpenProjectController({ status, opening, openError, onOpen }: OpenProjectControllerProps) {
  const sample = useWorkspaceFolder(SAMPLE_FOLDER);
  const projects = useProjectCards();
  const { tab, choose } = useOpenProjectTab(projects.count);
  const workspaceRoot = status.workspaceRoot ?? null;
  return (
    <OpenProjectPage
      workspaceRoot={workspaceRoot}
      lastProject={status.lastProject ?? null}
      opening={opening}
      error={openError}
      onOpen={onOpen}
      tabs={OPEN_PROJECT_TABS}
      tab={tab}
      onTab={choose}
      tabForKey={tabForKey}
      projectCount={projects.count}
      picker={<ProjectCardsPage cards={projects.cards} total={projects.total} truncated={projects.truncated} loading={projects.loading} error={projects.error} disabled={opening} onSelect={onOpen} onLoadMore={projects.loadMore} />}
      samplePath={sample.state === 'found' ? sample.path : null}
      sampleLoading={sample.state === 'loading'}
      newProject={<NewProjectController onCreated={onOpen} workspaceRoot={workspaceRoot} />}
      clone={<CloneController onCloned={onOpen} workspaceRoot={workspaceRoot} />}
    />
  );
}
