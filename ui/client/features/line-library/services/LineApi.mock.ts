// A LineApi with no server, built from the contract's own mock (packages/engine/line/mock.mjs), so this
// feature's view logic and tests run without ui/server. Each instance keeps its own files, so a change made
// through it shows in its next read. Not imported by the app.
import { createMockLineOps } from '../../../../../packages/engine/line/mock.mjs';
import { toApplyResult } from '../domain/ChangeText.ts';
import type { ApplyResult, LineApi, LineProject, MockLineChanges } from '../types.ts';

/** The contract mock's project, as GET /api/line/project would answer it. */
export function mockLineProject(): LineProject {
  return createMockLineOps().readLineProject('/mock') as LineProject;
}

/** A LineApi over one mock project, or one whose read is refused with `fail`. */
export function createMockLineApi({ fail }: { fail?: string } = {}): LineApi & MockLineChanges {
  const ops = createMockLineOps();
  const change = async (plan: () => { summary: string; files: { path: string; content: string | null }[] }): Promise<ApplyResult> => {
    try {
      return toApplyResult(ops.applyChange('/mock', plan()));
    } catch (e) {
      return toApplyResult({ ok: false, sentence: (e as { sentence?: string }).sentence });
    }
  };
  return {
    getLineProject: async () => (fail ? { ok: false, sentence: fail } : { ok: true, project: ops.readLineProject('/mock') as LineProject }),
    baseOn: (req) => change(() => ops.planBaseOn('/mock', req)),
    promote: (req) => change(() => ops.planPromote('/mock', req)),
  };
}
