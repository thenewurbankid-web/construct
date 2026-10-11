// The contract's own mock (plain ESM with JSDoc types, outside this app), used as is.
import { createMockLineOps } from '../../../../../packages/engine/line/mock.mjs';
import { treeFromSource } from '../domain/SourceTree';
import type { ApplyResult, FragmentList, LinePagesApi, LineProject, LineRefusal, SetFragmentRequest, SetPropRequest } from '../types';

type MockOps = {
  files: () => Record<string, string>;
  readLineProject: (root: string) => LineProject;
  planSetProp: (root: string, req: SetPropRequest) => unknown;
  applyChange: (root: string, change: unknown) => ApplyResult;
  listFragments: (root: string, file: string) => FragmentList;
  planSetFragment: (root: string, req: SetFragmentRequest) => unknown;
};

// The contract's mock behind the same calls the server answers, so the screen runs with no server routes: one
// in-memory project per browser tab (a Save changes it until the tab reloads), and a LineOpError becomes the same
// {ok: false, sentence, code} the server sends with a 400.
const ops = createMockLineOps() as unknown as MockOps;
const ROOT = '/mock';

/** A LineOpError as the server's 400 body; anything else is rethrown. */
function refusal(e: unknown): LineRefusal {
  const err = e as { name?: string; sentence?: string; code?: string; detail?: string };
  if (err.name === 'LineOpError' && err.sentence) return { ok: false, sentence: err.sentence, code: err.code ?? 'REFUSED', ...(err.detail ? { detail: err.detail } : {}) };
  throw e;
}

export const mockLinePagesApi: LinePagesApi = {
  getProject: async () => ops.readLineProject(ROOT),
  getPageTree: async (file) => treeFromSource(ops.files()[file] ?? '', file, file.split('/')[1] ?? ''),
  setPageProp: async (req): Promise<ApplyResult | LineRefusal> => {
    try {
      return ops.applyChange(ROOT, ops.planSetProp(ROOT, req));
    } catch (e) {
      return refusal(e);
    }
  },
  getFragments: async (file): Promise<FragmentList | LineRefusal> => {
    try {
      return ops.listFragments(ROOT, file);
    } catch (e) {
      return refusal(e);
    }
  },
  setFragment: async (req): Promise<ApplyResult | LineRefusal> => {
    try {
      return ops.applyChange(ROOT, ops.planSetFragment(ROOT, req));
    } catch (e) {
      return refusal(e);
    }
  },
};
