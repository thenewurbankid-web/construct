'use client';

import { ProjectGateController } from '@/features/project-gate';
import '../components/line-import-agent.css';
import { useImportAgent } from '../hooks/useImportAgent';
import { LineImportAgentPage } from '../pages/LineImportAgentPage';

function LineImportAgentScreen() {
  const controls = useImportAgent();
  return <LineImportAgentPage controls={controls} />;
}

/** The Import agent screen (`/import/agent`): the open project is the app; one folder of it is brought into Line by the
 * agent's plan, each change a plan step the person approves. */
export function LineImportAgentController() {
  return (
    <ProjectGateController>
      <LineImportAgentScreen />
    </ProjectGateController>
  );
}
