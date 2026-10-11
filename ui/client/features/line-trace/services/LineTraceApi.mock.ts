// A LineTraceApi with no server, on the contract's own static mapping (packages/engine/line/trace.mjs) over the
// contract mock's project, so this feature's logic and tests run without ui/server. Not imported by the app.
import { createMockLineOps } from '../../../../../packages/engine/line/mock.mjs';
import { traceMatch } from '../../../../../packages/engine/line/trace.mjs';
import type { LineTraceApi, TraceMatch } from '../types.ts';

export function createMockTraceApi(): LineTraceApi {
  const project = createMockLineOps().readLineProject('/mock');
  return {
    trace: async (req) => ({
      ok: true,
      match: (await traceMatch(req, { project })) as TraceMatch,
    }),
  };
}
