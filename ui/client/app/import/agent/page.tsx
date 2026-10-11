import { LineImportAgentController } from '@/features/line-import-agent/controllers/LineImportAgentController';

// The Import agent: one agent brings one folder of an existing app into Line, through a plan the person reviews and approves.
export default function Page() {
  return <LineImportAgentController />;
}
