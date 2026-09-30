'use client';

import { ProjectGateController } from '@/features/project-gate';
import { useShellDrawer } from '@/features/shell';
import '../components/debug.css';
import { buildDebugView } from '../domain/DebugView';
import { useDebug } from '../hooks/useDebug';
import { DebugPage } from '../pages/DebugPage';

function DebugScreen() {
  const drawer = useShellDrawer();
  const d = useDebug(drawer.openProcesses);
  return (
    <DebugPage
      view={buildDebugView(d.state)}
      onFeature={d.setFeature}
      onStart={() => void d.start()}
      onAnswer={(chooser, option) => void d.answer(chooser, option)}
      onApprove={() => void d.approve()}
      onOpenProcesses={drawer.openProcesses}
      onVerifyResult={(passed) => void d.verifyResult(passed)}
    />
  );
}

/** The Debug screen (`/debug`): reproduce -> isolate -> fix -> verify, closed options compiled to a plan
 * (LIN-137, part of LIN-82/epic #616). Nothing here calls a model except debug.fix's own "Fill with AI" exit. */
export function DebugController() {
  return (
    <ProjectGateController>
      <DebugScreen />
    </ProjectGateController>
  );
}
