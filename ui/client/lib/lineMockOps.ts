// The one in-memory Line project of mock mode (lib/lineMode.ts): the contract's own mock (packages/engine/line/mock.mjs,
// plain ESM with JSDoc types, outside this app), created once per browser tab, so a change made on one Line screen
// (a Save on Pages, an Apply on a fix) shows on every other until the tab reloads. Import it only dynamically, when
// mock mode is on, so it is never part of the normal screens' code.
import { createMockLineOps } from '../../../packages/engine/line/mock.mjs';
import type { ApplyResult, BindInteractionRequest, BindPartRequest, FixRequest, FragmentList, LinePageBinding, LineProject, LineRefusal, SetFragmentRequest, SetPropRequest } from './lineContract';

export type MockLineOps = {
  files: () => Record<string, string>;
  readLineProject: (root: string) => LineProject;
  planSetProp: (root: string, req: SetPropRequest) => unknown;
  applyChange: (root: string, change: unknown) => ApplyResult;
  applyFix: (root: string, req: FixRequest) => ApplyResult;
  listFragments: (root: string, file: string) => FragmentList;
  planSetFragment: (root: string, req: SetFragmentRequest) => unknown;
  readPageBinding: (root: string, file: string) => LinePageBinding;
  planBindPart: (root: string, req: BindPartRequest) => unknown;
  planBindInteraction: (root: string, req: BindInteractionRequest) => unknown;
};

export const MOCK_ROOT = '/mock';

export const mockLineOps = createMockLineOps() as unknown as MockLineOps;

/** Runs one mock call; a LineOpError becomes the same {ok: false, sentence, code, detail?} the server sends with a
 * 400. Anything else is rethrown. */
export function mockWrite<T>(run: () => T): T | LineRefusal {
  try {
    return run();
  } catch (e) {
    const err = e as { name?: string; sentence?: string; code?: string; detail?: string };
    if (err.name === 'LineOpError' && err.sentence) return { ok: false, sentence: err.sentence, code: err.code ?? 'REFUSED', ...(err.detail ? { detail: err.detail } : {}) };
    throw e;
  }
}
