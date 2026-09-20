'use client';

import { ProjectGateController } from '@/features/project-gate';
import { CommitIndicatorController } from '@/features/git-session';
import { usePagesEditor } from '../hooks/usePagesEditor';
import { usePagesEditorTabs } from '../hooks/usePagesEditorTabs';
import { PagesEditorPage } from '../pages/PagesEditorPage';

// Mounted only once a project is chosen, so the shell's Browser/Tools tabs
// appear (and disappear) with the Pages Editor screen.
function PagesEditorScreen() {
  const pagesEditor = usePagesEditor();
  usePagesEditorTabs(pagesEditor);
  // Commit-on-save (#283) is composed in as a slot: the Pages Editor knows nothing about git,
  // and the same controller drops into any other edit surface unchanged.
  return <PagesEditorPage {...pagesEditor} gitSession={<CommitIndicatorController />} />;
}

export function PagesEditorController() {
  return (
    <ProjectGateController>
      <PagesEditorScreen />
    </ProjectGateController>
  );
}
