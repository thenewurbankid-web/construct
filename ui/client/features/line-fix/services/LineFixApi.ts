import { isLineMock } from '@/lib/lineMode';
import { runPlanStepsNow, stepApply } from '@/lib/linePlanRun';
import { fixResult } from '../domain/FixOptions';
import type { FixRequest, LineFixApi } from '../types';

// The panel's write: a `line.fix` step of the project's plan (owner decision a, 11 Oct). The person's click on Apply
// is the approval, so the step is added, approved and run in one go (lib/linePlanRun.ts) and shows in the Plan panel
// as done; the server re-derives the finding by key, plans the fix and writes it through Construct's writer. A fix the
// writer refuses is left as it is, so it does not hold the plan. In Line mock mode (?line=mock) the same call goes to
// the tab's one in-memory project (lib/lineMockOps.ts), loaded only then. A refusal or a silent server is one sentence.
async function fix(req: FixRequest) {
  if (isLineMock()) {
    try {
      const { MOCK_ROOT, mockLineOps, mockWrite } = await import('@/lib/lineMockOps');
      return fixResult(mockWrite(() => mockLineOps.applyFix(MOCK_ROOT, req)));
    } catch {
      return fixResult({ ok: false, sentence: 'The Cockpit server did not answer.' });
    }
  }
  const r = await runPlanStepsNow([{ tool: 'line.fix', args: { ...req } }], { leaveIfRefused: true });
  if (!r.ok) return fixResult(r);
  const step = r.ran[0];
  return fixResult(stepApply(step) ?? { ok: false, sentence: step?.sentence ?? 'The fix did not run.' });
}

export const lineFixApi: LineFixApi = { fix };
