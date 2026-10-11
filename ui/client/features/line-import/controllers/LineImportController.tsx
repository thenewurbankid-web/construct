'use client';

import { ProjectGateController } from '@/features/project-gate';
import '../components/line-import.css';
import { useImport } from '../hooks/useImport';
import { LineImportPage } from '../pages/LineImportPage';

function LineImportScreen() {
  const controls = useImport();
  return <LineImportPage controls={controls} />;
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
