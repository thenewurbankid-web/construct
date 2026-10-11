// The Pages screen over mock mode's one in-memory project (lib/lineMockOps.ts), shared with every other Line screen
// in the tab (an Apply on a fix shows here too).
import { MOCK_ROOT, mockLineOps as ops, mockWrite } from '@/lib/lineMockOps';
import { treeFromSource } from '../domain/SourceTree';
import type { LinePagesApi } from '../types';

export const mockLinePagesApi: LinePagesApi = {
  getProject: async () => ops.readLineProject(MOCK_ROOT),
  getPageTree: async (file) => treeFromSource(ops.files()[file] ?? '', file, file.split('/')[1] ?? ''),
  setPageProp: async (req) => mockWrite(() => ops.applyChange(MOCK_ROOT, ops.planSetProp(MOCK_ROOT, req))),
};
