'use client';

import { PagesEditorController } from '@/features/pages-editor';
import { usePagesScreen } from '../hooks/usePagesScreen';
import { PagesScreenPage } from '../pages/PagesScreenPage';

/** /pages: a Line project gets the Line Pages screen; any other project keeps today's Pages editor, untouched. */
export function PagesScreenController() {
  const { phase, view } = usePagesScreen();
  return <PagesScreenPage phase={phase} view={view} fallback={<PagesEditorController />} />;
}
