'use client';

import { useMemo } from 'react';
import { ComponentsController } from '@/features/component-docs';
import { ProjectGateController } from '@/features/project-gate';
import '../components/line-library.css';
import { LineScreenSwitch } from '../components/LineScreenSwitch';
import { screenFor } from '../domain/LibraryView';
import { useLineProject } from '../hooks/useLineProject';

function LineComponentsScreen() {
  const { state } = useLineProject();
  const screen = useMemo(() => screenFor(state), [state]);
  return <LineScreenSwitch screen={screen} fallback={<ComponentsController />} />;
}

/** The Components screen (`/components`): a `preset: line` project gets its library as cards by level plus each
 * feature's components with their base links; any other project, or a Line view that could not be read, gets the
 * existing Components screen unchanged. */
export function LineComponentsController() {
  return (
    <ProjectGateController>
      <LineComponentsScreen />
    </ProjectGateController>
  );
}
