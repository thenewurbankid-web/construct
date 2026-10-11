// The contract's own Import agent mock (plain ESM with JSDoc types, outside this app), used as is: the REAL agent process
// over ci1's import mock (examples/import-sample, folder src/alerts) and an in-memory plan with one planted refusal, so
// the correction loop shows. A LineOpError becomes the same {ok: false, sentence, code} the server sends with a 400.
import { createMockImportAgentService } from '../../../../../packages/engine/line/mockImportAgent.mjs';
import { createMockImport } from '../../../../../packages/engine/line/mockImport.mjs';
import type { ImportAgentApi, ImportAgentView, ImportFolders, LineRefusal } from '../types';
import type { PlanView } from '@/lib/lineContract';

type Agent = {
  view: () => Promise<ImportAgentView>;
  start: (by: string) => Promise<ImportAgentView | LineRefusal>;
  resume: (by: string) => Promise<ImportAgentView | LineRefusal>;
  pause: (by: string) => Promise<ImportAgentView | LineRefusal>;
  editStep: (by: string, edit: unknown) => Promise<ImportAgentView | LineRefusal>;
  answer: (by: string, q: string, o: string) => Promise<ImportAgentView | LineRefusal>;
};
type Service = { agentFor: (folder: string) => Agent; planService: { approve: (id: string, by: string) => Promise<PlanView | LineRefusal> } };

const service = createMockImportAgentService() as unknown as Service;
const folders = (createMockImport() as unknown as { folders: () => ImportFolders }).folders;

async function answer<T>(fn: () => Promise<T>): Promise<T | LineRefusal> {
  try {
    return await fn();
  } catch (e) {
    const err = e as { sentence?: string; code?: string };
    return { ok: false, sentence: err.sentence ?? 'Cockpit could not do that; nothing was changed.', code: err.code ?? 'INTERNAL' };
  }
}

export const mockImportAgentApi: ImportAgentApi = {
  importFolders: () => answer(async () => folders()),
  getImportAgent: (folder) => answer(() => service.agentFor(folder).view()),
  startImportAgent: (folder) => answer(() => service.agentFor(folder).start('ui')),
  resumeImportAgent: (folder) => answer(() => service.agentFor(folder).resume('ui')),
  pauseImportAgent: (folder) => answer(() => service.agentFor(folder).pause('ui')),
  editImportStep: (req) => answer(() => service.agentFor(req.folder).editStep('ui', req)),
  answerImportAgent: (req) => answer(() => service.agentFor(req.folder).answer('ui', req.questionId, req.optionId)),
  approvePlanStep: (stepId) => answer(() => service.planService.approve(stepId, 'ui')),
};
