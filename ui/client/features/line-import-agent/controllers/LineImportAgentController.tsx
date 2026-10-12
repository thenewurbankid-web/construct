'use client';

import { useMemo } from 'react';
import { ScreenModesController } from '@/features/line-modes';
import { ProjectGateController } from '@/features/project-gate';
import '../components/line-import-agent.css';
import { IMPORT_AGENT_MODES } from '../domain/ImportAgentModes';
import { useImportAgent } from '../hooks/useImportAgent';
import { LineImportAgentPage } from '../pages/LineImportAgentPage';

function LineImportAgentScreen() {
  const controls = useImportAgent();
  const { screen } = controls;
  const data = useMemo(
    () => ({ started: screen.started, sentence: screen.sentence, stages: screen.stages, rows: screen.rows.map((r) => ({ id: r.id, n: r.n, sentence: r.sentence, outcome: r.outcome })) }),
    [screen.started, screen.sentence, screen.stages, screen.rows],
  );
  return <ScreenModesController provider={IMPORT_AGENT_MODES} data={data} hood={<LineImportAgentPage controls={controls} />} />;
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
