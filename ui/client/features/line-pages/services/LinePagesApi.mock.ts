// The Pages screen over mock mode's one in-memory project (lib/lineMockOps.ts), shared with every other Line screen
// in the tab (an Apply on a fix shows here too). A LineOpError becomes the same {ok: false, sentence, code} the
// server sends with a 400 (mockWrite).
import { MOCK_ROOT, mockLineOps as ops, mockWrite } from '@/lib/lineMockOps';
import { treeFromSource } from '../domain/SourceTree';
import type { LinePagesApi } from '../types';

export const mockLinePagesApi: LinePagesApi = {
  getProject: async () => ops.readLineProject(MOCK_ROOT),
  getPageTree: async (file) => treeFromSource(ops.files()[file] ?? '', file, file.split('/')[1] ?? ''),
  setPageProp: async (req) => mockWrite(() => ops.applyChange(MOCK_ROOT, ops.planSetProp(MOCK_ROOT, req))),
  getFragments: async (file) => mockWrite(() => ops.listFragments(MOCK_ROOT, file)),
  setFragment: async (req) => mockWrite(() => ops.applyChange(MOCK_ROOT, ops.planSetFragment(MOCK_ROOT, req))),
  getPageBinding: async (file) => mockWrite(() => ops.readPageBinding(MOCK_ROOT, file)),
  bindPart: async (req) => mockWrite(() => ops.applyChange(MOCK_ROOT, ops.planBindPart(MOCK_ROOT, req))),
  bindInteraction: async (req) => mockWrite(() => ops.applyChange(MOCK_ROOT, ops.planBindInteraction(MOCK_ROOT, req))),
};
