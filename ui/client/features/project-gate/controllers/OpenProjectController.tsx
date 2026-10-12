'use client';

import { useCallback, useMemo } from 'react';
import { CloneController } from '@/features/clone';
import { NewProjectController } from '@/features/new-project';
import { ProjectCardsPage, useProjectCards, useWorkspaceFolder } from '@/features/directory-browser';
import { ScreenModesController, type ScreenControl } from '@/features/line-modes';
import { LineTraceController } from '@/features/line-trace';
import type { Place } from '@/lib/lineModes';
import type { StreamElements } from '@/lib/StreamedText';
import { ChatProjectCard } from '../components/ChatProjectCard';
import { OPEN_MODES } from '../domain/OpenModes';
import { OPEN_PROJECT_TABS, tabForKey } from '../domain/OpenProjectTabs';
import { useOpenModes } from '../hooks/useOpenModes';
import { useOpenProjectHelper } from '../hooks/useOpenProjectHelper';
import { useOpenProjectTab } from '../hooks/useOpenProjectTab';
import { OpenProjectPage } from '../pages/ProjectGatePage';
import type { ProjectStatus } from '../types';

/** The folder that gets the one-click "Try the sample shop" shortcut (the screen's button and the chat's option). */
const SAMPLE_FOLDER = 'shop';

type OpenProjectControllerProps = {
  status: ProjectStatus;
  opening: boolean;
  openError: string | null;
  onOpen: (dir: string) => void;
};

/** #365: the "Open a project" screen, mounted only while no project is open, in its two modes (Chat | Under the hood).
 * The projects (directory-browser, scoped by the server to the workspace) come first as cards; New project and From
 * GitHub are their own features' question series, each in its own tab (kept in the URL). The one chat is the two-modes
 * chat: Reopen and the sample, the ways in, and the helper's requests (typed or as options) with Trace and Auto under
 * it (owner decision, 12 Oct: no second helper panel). */
export function OpenProjectController({ status, opening, openError, onOpen }: OpenProjectControllerProps) {
  const sample = useWorkspaceFolder(SAMPLE_FOLDER);
  const projects = useProjectCards();
  const { tab, choose } = useOpenProjectTab(projects.count);
  const workspaceRoot = status.workspaceRoot ?? null;
  const samplePath = sample.state === 'found' ? sample.path : null;
  const modes = useOpenModes(workspaceRoot, status.lastProject ?? null, samplePath, onOpen);
  const helper = useOpenProjectHelper(projects.cards, onOpen);
  const onOption = useCallback(
    (optionId: string, _place: Place, control: ScreenControl) => {
      if (!helper.onOption(optionId, control)) modes.onOption(optionId);
    },
    [helper, modes],
  );
  const elements = useMemo<StreamElements>(() => ({ ProjectCard: ({ name }) => <ChatProjectCard name={name ?? ''} onOpenProject={helper.openProject} /> }), [helper.openProject]);
  const screen = (
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
      samplePath={samplePath}
      sampleLoading={sample.state === 'loading'}
      newProject={<NewProjectController onCreated={onOpen} workspaceRoot={workspaceRoot} />}
      clone={<CloneController onCloned={onOpen} workspaceRoot={workspaceRoot} />}
    />
  );
  return (
    <ScreenModesController
      provider={OPEN_MODES}
      data={modes.data}
      hood={screen}
      onOption={onOption}
      ask={helper.ask}
      input={helper.input}
      onAnswer={(askId, text, control) => helper.onAnswer(askId, text, control)}
      onCancelAsk={helper.onCancelAsk}
      onOwnPick={(_messageId, itemId) => helper.openProject(itemId)}
      elements={elements}
      footer={<LineTraceController screen="open-project" api={helper.traceApi} />}
    />
  );
}
