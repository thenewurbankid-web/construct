'use client';

import { ProjectGateController } from '@/features/project-gate';
import { usePagesEditor } from '../hooks/usePagesEditor';
import { PagesEditorPage } from '../pages/PagesEditorPage';

export function PagesEditorController() {
  const pagesEditor = usePagesEditor();
  return (
    <ProjectGateController>
      <PagesEditorPage {...pagesEditor} />
    </ProjectGateController>
  );
}
