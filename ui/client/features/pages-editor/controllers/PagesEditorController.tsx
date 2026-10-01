'use client';

import { useState } from 'react';
import { ProjectGateController } from '@/features/project-gate';
import { CommitIndicatorController } from '@/features/git-session';
import { DevServerController } from '@/features/dev-server';
import { usePreviewServerUrl } from '@/features/live-preview';
import type { ChangeImpactPreview } from '../domain/ChangeImpact';
import { usePagesEditor } from '../hooks/usePagesEditor';
import { usePagesEditorTabs } from '../hooks/usePagesEditorTabs';
import { PagesEditorPage } from '../pages/PagesEditorPage';

// Mounted only once a project is chosen, so the shell's Browser/Tools tabs
// appear (and disappear) with the Pages Editor screen.
function PagesEditorScreen() {
  const pagesEditor = usePagesEditor();
  // #381 — the Change tab's pending refactor, drawn as a dashed-box preview over the live app. Lives here,
  // not in usePagesEditor's own reducer: it is UI-only state private to the Change tab and the stage, and
  // never needs to survive a save/reload the way the tree/selection does.
  const [changeImpact, setChangeImpact] = useState<ChangeImpactPreview | null>(null);
  usePagesEditorTabs(pagesEditor, setChangeImpact);
  const onServerUrl = usePreviewServerUrl(pagesEditor.livePreview);
  // Commit-on-save (#283) and the dev server (#378) are composed in as slots: the Pages Editor knows
  // nothing about git or how a server is started, and the same controllers drop into any other edit surface.
  return <PagesEditorPage {...pagesEditor} changeImpact={changeImpact} gitSession={<CommitIndicatorController />} devServer={<DevServerController onUrl={onServerUrl} />} />;
}

export function PagesEditorController() {
  return (
    <ProjectGateController>
      <PagesEditorScreen />
    </ProjectGateController>
  );
}
