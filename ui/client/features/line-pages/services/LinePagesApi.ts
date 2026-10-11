import { getJson, postJson } from '@/lib/http';
import type { ApplyResult, LinePagesApi, LinePageTree, LineProject, LineRefusal } from '../types';
import { isLineMock } from './LineMode';

// The Pages screen's mirror of LINE_API (packages/engine/line/contract.mjs): GET /api/line/project,
// GET /api/line/page-tree?file= (the page's parts, packages/engine/line/pageProp.mjs readPageTree) and
// POST /api/line/page-prop. A LineOpError arrives as 400 {ok: false, sentence, code}; postJson reads the body
// whatever the status, so a refusal reaches the screen as its sentence.
export const realLinePagesApi: LinePagesApi = {
  getProject: () => getJson<LineProject>('/api/line/project'),
  getPageTree: (file) => getJson<LinePageTree>(`/api/line/page-tree?file=${encodeURIComponent(file)}`),
  setPageProp: (req) => postJson<ApplyResult | LineRefusal>('/api/line/page-prop', req),
};

/** The API the screen talks to: the contract's in-memory mock when Line mock mode is on, the server otherwise.
 * The mock is loaded only when asked for, so it is never part of the normal screen's code. */
export async function loadLinePagesApi(): Promise<LinePagesApi> {
  if (!isLineMock()) return realLinePagesApi;
  const { mockLinePagesApi } = await import('./LinePagesApi.mock');
  return mockLinePagesApi;
}
