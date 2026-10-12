'use client';

import { useMemo } from 'react';
import type { Place } from '@/lib/lineModes';
import type { ImportModeData } from '../domain/ImportModes';
import type { ImportControls } from '../types';

/** Two modes on Import: what the chat reads, the chat's folder as the screen's folder, and "Read this folder" as the
 * screen's own Read. */
export function useImportModes({ state, view, setFolder, scan }: ImportControls) {
  const data: ImportModeData = useMemo(
    () => ({ folders: state.folders ? state.folders.folders.map((f) => f.path) : null, folder: state.folder, phase: state.phase, summary: view.summary, error: state.error }),
    [state.folders, state.folder, state.phase, view.summary, state.error],
  );
  const onPlace = (place: Place) => {
    const folder = place.steps[0]?.id;
    if (folder && folder !== state.folder) setFolder(folder);
  };
  const onOption = (optionId: string) => {
    if (optionId === 'import.scan') scan();
  };
  return { data, onPlace, onOption };
}
