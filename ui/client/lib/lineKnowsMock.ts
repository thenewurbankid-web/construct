// "What Line knows" in mock mode (lib/lineMode.ts): the contract's own mock (packages/engine/line/knows/mock.mjs), one
// per browser tab. Import it only dynamically, when mock mode is on, so it is never part of the normal page's code.
import { createMockKnows } from '../../../packages/engine/line/knows/mock.mjs';
import type { KnowsHttp } from './lineKnowsContract';

const mock = createMockKnows() as unknown as Record<string, (...a: unknown[]) => unknown>;
const later = <T>(v: unknown) => Promise.resolve(v as T);

/** The page's routes answered by the mock (same shapes as the server). */
export const mockKnowsHttp: KnowsHttp = {
  graph: (focus) => later(mock.graph(focus)),
  changes: () => later(mock.changes()),
  stats: () => later(mock.stats()),
  memorySteps: () => later(mock.memory()),
  memoryRecords: (step) => later(mock.records(step ? { step } : {})),
  memoryEdit: (id, chosen) => later(mock.edit({ id, chosen })),
  memoryForgetStep: (step) => { mock.forgetStep({ step }); return later(mock.memory()); },
  memoryForgetRecord: (id) => later(mock.forgetRecord({ id })),
  memoryForgetAll: () => later(mock.forgetAll()),
  memoryExport: () => later(mock.exportMemory()),
  memoryImport: (file) => later(mock.importMemory(file)),
  memoryEmbeddings: (on) => later(mock.setEmbeddings({ on })),
  mockApplied: (changeId) => { mock.applyChange(changeId); },
};
