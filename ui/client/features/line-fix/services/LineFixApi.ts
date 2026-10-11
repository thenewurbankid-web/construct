import { isLineMock } from '@/lib/lineMode';
import { lineHttp } from '@/lib/lineHttp';
import { fixResult } from '../domain/FixOptions';
import type { FixRequest, LineFixApi } from '../types';

// The panel's use of the shared LINE_API mirror: POST /api/line/fix (the server re-derives the finding by key, plans
// the fix and writes it through Construct's writer). In Line mock mode (?line=mock) the same call goes to the tab's
// one in-memory project (lib/lineMockOps.ts), loaded only then. A refusal or a network failure is one sentence.
async function fix(req: FixRequest) {
  try {
    if (isLineMock()) {
      const { MOCK_ROOT, mockLineOps, mockWrite } = await import('@/lib/lineMockOps');
      return fixResult(mockWrite(() => mockLineOps.applyFix(MOCK_ROOT, req)));
    }
    return fixResult(await lineHttp.fix(req));
  } catch {
    return fixResult({ ok: false, sentence: 'The Cockpit server did not answer.' });
  }
}

export const lineFixApi: LineFixApi = { fix };
