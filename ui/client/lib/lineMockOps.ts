// The one in-memory Line project of mock mode (lib/lineMode.ts): the contract's own mock (packages/engine/line/mock.mjs,
// plain ESM with JSDoc types, outside this app), created once per browser tab, so a change made on one Line screen
// (a Save on Pages, an Apply on a fix) shows on every other until the tab reloads. Import it only dynamically, when
// mock mode is on, so it is never part of the normal screens' code.
import { createMockLineOps } from '../../../packages/engine/line/mock.mjs';
import type { ApplyResult, FixRequest, LineProject, LineRefusal, SetPropRequest } from './lineContract';

export type MockLineOps = {
  files: () => Record<string, string>;
  readLineProject: (root: string) => LineProject;
  planSetProp: (root: string, req: SetPropRequest) => unknown;
  applyChange: (root: string, change: unknown) => ApplyResult;
  applyFix: (root: string, req: FixRequest) => ApplyResult;
};

export const MOCK_ROOT = '/mock';

export const mockLineOps = createMockLineOps() as unknown as MockLineOps;

/** Runs one mock write; a LineOpError becomes the same {ok: false, sentence, code} the server sends with a 400. */
export function mockWrite(run: () => ApplyResult): ApplyResult | LineRefusal {
  try {
    return run();
  } catch (e) {
    const err = e as { name?: string; sentence?: string; code?: string };
    if (err.name === 'LineOpError' && err.sentence) return { ok: false, sentence: err.sentence, code: err.code ?? 'REFUSED' };
    throw e;
  }
}
