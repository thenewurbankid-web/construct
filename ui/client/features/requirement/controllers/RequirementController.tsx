'use client';

import { ProjectGateController } from '@/features/project-gate';
import { useShellDrawer } from '@/features/shell';
import '../components/requirement.css';
import { buildRequirementView } from '../domain/RequirementView';
import { useRequirement } from '../hooks/useRequirement';
import { RequirementPage } from '../pages/RequirementPage';

function RequirementScreen() {
  const drawer = useShellDrawer();
  const r = useRequirement(drawer.openProcesses);
  return (
    <RequirementPage
      view={buildRequirementView(r.state)}
      onText={r.setText}
      onExample={(text) => void r.pickExample(text)}
      onRead={() => void r.read()}
      onAnswer={(question, option) => void r.answer(question, option)}
      onApprove={() => void r.approve()}
      onSaveNote={() => void r.saveNote()}
      onOpenProcesses={drawer.openProcesses}
    />
  );
}

/** The Requirement screen (`/requirement`): a sentence read back as a card, a placement and a timeline, then approved into a plan.
 * Nothing here calls a model. */
export function RequirementController() {
  return (
    <ProjectGateController>
      <RequirementScreen />
    </ProjectGateController>
  );
}
