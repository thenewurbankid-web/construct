// A LineApi with no server, built from the contract's own mock (packages/engine/line/mock.mjs), so this
// feature's view logic and tests run without ui/server. Not imported by the app.
import { createMockLineOps } from '../../../../../packages/engine/line/mock.mjs';
import type { LineApi, LineProject } from '../types';

/** The contract mock's project, as GET /api/line/project would answer it. */
export function mockLineProject(): LineProject {
  return createMockLineOps().readLineProject('/mock') as LineProject;
}

/** A LineApi answering the mock project, or a refusal sentence when `fail` is given. */
export function createMockLineApi({ fail }: { fail?: string } = {}): LineApi {
  return {
    getLineProject: async () => (fail ? { ok: false, sentence: fail } : { ok: true, project: mockLineProject() }),
  };
}
