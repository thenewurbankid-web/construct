// The contract's own import mock (plain ESM with JSDoc types, outside this app), used as is: examples/import-sample's folder
// src/alerts, kept equal to the real engine by test/line-import.test.mjs. A LineOpError becomes the same
// {ok: false, sentence, code} the server sends with a 400.
import { createMockImport } from '../../../../../packages/engine/line/mockImport.mjs';
import type { ImportApi, ImportApplyResult, ImportFolders, ImportPlan, ImportScan, LineRefusal } from '../types';

type MockImport = {
  folders: () => ImportFolders;
  scan: (req: { folder: string }) => ImportScan;
  plan: (req: { folder: string; answers: Record<string, string> }) => ImportPlan;
  apply: (req: { folder: string; answers: Record<string, string> }) => ImportApplyResult;
};

const mock = createMockImport() as unknown as MockImport;

async function answer<T>(fn: () => T): Promise<T | LineRefusal> {
  try {
    return fn();
  } catch (e) {
    const err = e as { sentence?: string; code?: string };
    return { ok: false, sentence: err.sentence ?? 'Cockpit could not do that; nothing was changed.', code: err.code ?? 'INTERNAL' };
  }
}

export const mockImportApi: ImportApi = {
  importFolders: () => answer(() => mock.folders()),
  importScan: (req) => answer(() => mock.scan(req)),
  importPlan: (req) => answer(() => mock.plan(req)),
  importApply: (req) => answer(() => mock.apply(req)),
  // The mock's apply is all or nothing and never stops halfway, so there is nothing to undo or leave.
  importUndo: async () => ({ ok: false, sentence: 'There is nothing to undo in mock mode.', code: 'NOTHING_TO_UNDO' }),
  importLeave: async () => ({ ok: false, sentence: 'There is nothing to leave in mock mode.', code: 'NOTHING_TO_LEAVE' }),
};
