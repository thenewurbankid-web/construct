'use client';

import { ProjectGateController } from '@/features/project-gate';
import { usePagesEditor } from '../hooks/usePagesEditor';
import { usePagesEditorTabs } from '../hooks/usePagesEditorTabs';
import { PagesEditorPage } from '../pages/PagesEditorPage';

// Mounted only once a project is chosen, so the shell's Browser/Tools tabs
// appear (and disappear) with the Pages Editor screen.
function PagesEditorScreen() {
  const pagesEditor = usePagesEditor();
  usePagesEditorTabs(pagesEditor);
  return <PagesEditorPage {...pagesEditor} />;
}

export function PagesEditorController() {
  return (
    <ProjectGateController>
      <PagesEditorScreen />
    </ProjectGateController>
  );
}
