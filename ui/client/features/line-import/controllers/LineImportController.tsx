'use client';

import { useMemo } from 'react';
import { ScreenModesController } from '@/features/line-modes';
import { ProjectGateController } from '@/features/project-gate';
import type { Place } from '@/lib/lineModes';
import '../components/line-import.css';
import { IMPORT_MODES } from '../domain/ImportModes';
import { useImport } from '../hooks/useImport';
import { LineImportPage } from '../pages/LineImportPage';

function LineImportScreen() {
  const controls = useImport();
  const { state, view, setFolder, scan } = controls;
  const data = useMemo(
    () => ({ folders: state.folders?.folders.map((f) => f.path) ?? [], folder: state.folder, phase: state.phase, summary: view.summary, error: state.error }),
    [state.folders, state.folder, state.phase, view.summary, state.error],
  );
  // Two modes: the chat's folder is the screen's folder; "Read this folder" is the screen's own Read.
  const onPlace = (place: Place) => {
    const folder = place.steps[0]?.id;
    if (folder && folder !== state.folder) setFolder(folder);
  };
  const onOption = (optionId: string) => {
    if (optionId === 'import.scan') scan();
  };
  return <ScreenModesController provider={IMPORT_MODES} data={data} hood={<LineImportPage controls={controls} />} onPlace={onPlace} onOption={onOption} />;
}

/** The Import screen (`/import`): the open project is the app; one folder of it is brought into Line through plan steps
 * that Construct's writer lands inside that folder only. */
export function LineImportController() {
  return (
    <ProjectGateController>
      <LineImportScreen />
    </ProjectGateController>
  );
}
