'use client';

import { ProjectGateController } from '@/features/project-gate';
import { CommitIndicatorController } from '@/features/git-session';
import { DevServerController } from '@/features/dev-server';
import { usePagesEditor } from '../hooks/usePagesEditor';
import { usePagesEditorTabs } from '../hooks/usePagesEditorTabs';
import { usePreviewServerUrl } from '../hooks/usePreviewServerUrl';
import { PagesEditorPage } from '../pages/PagesEditorPage';

// Mounted only once a project is chosen, so the shell's Browser/Tools tabs
// appear (and disappear) with the Pages Editor screen.
function PagesEditorScreen() {
  const pagesEditor = usePagesEditor();
  usePagesEditorTabs(pagesEditor);
  const onServerUrl = usePreviewServerUrl(pagesEditor.livePreview);
  // Commit-on-save (#283) and the dev server (#378) are composed in as slots: the Pages Editor knows
  // nothing about git or how a server is started, and the same controllers drop into any other edit surface.
  return <PagesEditorPage {...pagesEditor} gitSession={<CommitIndicatorController />} devServer={<DevServerController onUrl={onServerUrl} />} />;
}

export function PagesEditorController() {
  return (
    <ProjectGateController>
      <PagesEditorScreen />
    </ProjectGateController>
  );
}
