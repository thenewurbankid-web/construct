'use client';

import { ScreenModesController } from '@/features/line-modes';
import { ProjectGateController } from '@/features/project-gate';
import '../components/line-import.css';
import { IMPORT_MODES } from '../domain/ImportModes';
import { useImport } from '../hooks/useImport';
import { useImportModes } from '../hooks/useImportModes';
import { LineImportPage } from '../pages/LineImportPage';

function LineImportScreen() {
  const controls = useImport();
  const { data, onPlace, onOption } = useImportModes(controls);
  return <ScreenModesController provider={IMPORT_MODES} data={data} hood={<LineImportPage controls={controls} />} onPlace={onPlace} onOption={onOption} />;
}

/** The Import screen (`/import`): the open project is the app; one folder of it is brought into Line through plan steps
 * that Construct's writer lands inside that folder only. Two modes: a chat (pick a folder, read it) or the screen. */
export function LineImportController() {
  return (
    <ProjectGateController>
      <LineImportScreen />
    </ProjectGateController>
  );
}
